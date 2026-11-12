// CONF-06 / CONF-07: bandeja de entrada durable. El evento se guarda completo
// antes de procesarse; si la función se corta o el trabajo posterior falla, el
// reintento (de Zernio o del cron) lo retoma sin duplicar chat, gestión ni bot;
// tras 3 intentos fallidos pasa a 'failed' y avisa a los administradores.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const { runInboundPipeline } = vi.hoisted(() => ({
  runInboundPipeline: vi.fn(async (..._args: unknown[]): Promise<{ casesOk: boolean; casesError?: string } | undefined> => ({ casesOk: true })),
}));
vi.mock("@/lib/inbound-pipeline", () => ({ runInboundPipeline }));

import {
  INBOUND_LOCK_MS,
  MAX_INBOUND_ATTEMPTS,
  buildStoredPayload,
  claimInboundEvent,
  prepareInboundEvent,
  processStoredInbound,
  pruneWebhookEvents,
  releaseAfterPrepareFailure,
  sweepInboundEvents,
  sweepOrphanChats,
} from "./inbound-events";

const WS = "ws-1";
let db: FakeDb;
type Channel = Parameters<typeof prepareInboundEvent>[2];
let channel: Channel;

const payload = (over: Record<string, unknown> = {}) =>
  buildStoredPayload({
    at: new Date().toISOString(),
    preview: "Hola",
    lateConversationId: "z-1",
    lateAccountId: "acc",
    platformMessageId: "wamid.1",
    text: "Hola",
    sender: { id: "51999111222", name: "Lucía", username: null },
    ...over,
  });

const farFuture = () => Date.now() + 60_000;
const events = () => db.rows("webhook_events");

beforeEach(() => {
  runInboundPipeline.mockReset();
  runInboundPipeline.mockResolvedValue({ casesOk: true });
  db = new FakeDb();
  db.unique("webhook_events", ["event_id"]);
  db.unique("contact_channels", ["channel_id", "platform_sender_id"]);
  [channel] = db.seed("channels", [
    { id: "ch-1", workspace_id: WS, platform: "whatsapp", late_account_id: "acc", is_active: true, username: "tienda" },
  ]) as unknown as [Channel];
  db.seed("workspace_members", [
    { workspace_id: WS, user_id: "owner-1", role: "owner" },
    { workspace_id: WS, user_id: "admin-1", role: "admin" },
    { workspace_id: WS, user_id: "agent-1", role: "member" },
  ]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

async function claimAndPrepare(id = "evt-1", p = payload()) {
  const claim = await claimInboundEvent(db.asDb(), { eventId: id, channelId: "ch-1", payload: p });
  if (claim.kind === "duplicate" || claim.kind === "untracked") throw new Error(`claim ${claim.kind}`);
  const prepared = await prepareInboundEvent(db.asDb(), claim.row, channel);
  return { claim, prepared };
}

describe("reclamar el evento", () => {
  it("guarda el cuerpo reducido (sin foto de perfil ni archivos) y el estado 'received'", async () => {
    const claim = await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
    expect(claim.kind).toBe("new");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ event_id: "evt-1", status: "received", attempts: 1, channel_id: "ch-1" });
    const stored = events()[0].payload as Record<string, unknown>;
    expect(stored.text).toBe("Hola");
    expect(JSON.stringify(stored)).not.toMatch(/picture|attachments|url/i);
  });

  it("un evento ya procesado es duplicado; uno en curso (candado vigente) también", async () => {
    await claimAndPrepare("evt-1");
    // En curso: el candado de 60 s sigue vigente.
    expect((await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() })).kind).toBe("duplicate");
    events()[0].status = "processed";
    events()[0].locked_until = null;
    expect((await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() })).kind).toBe("duplicate");
  });

  it("si la función se cortó a mitad (candado vencido), el reintento de Zernio NO es duplicado: lo retoma", async () => {
    const { claim } = await claimAndPrepare("evt-1");
    expect(claim.kind).toBe("new");
    // Pasó el candado y el evento nunca terminó.
    events()[0].locked_until = new Date(Date.now() - 1000).toISOString();

    const retry = await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
    expect(retry.kind).toBe("retake");
    expect(events()[0].attempts).toBe(2);
    // Ya tenía contacto y chat: no se vuelve a guardar ni a sumar el no leído.
    if (retry.kind !== "retake") return;
    expect(retry.row.status).toBe("stored");
    await prepareInboundEvent(db.asDb(), retry.row, channel);
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0].unread_count).toBe(1);
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("si falla la tabla, procesa sin bandeja durable (no pierde el mensaje)", async () => {
    db.failNext.set("webhook_events", "insert");
    const claim = await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
    expect(claim.kind).toBe("untracked");
    if (claim.kind !== "untracked") return;
    const prepared = await prepareInboundEvent(db.asDb(), claim.row, channel);
    expect(prepared.ok).toBe(true);
    expect(await processStoredInbound(db.asDb(), claim.row, channel)).toBe("processed");
    expect(events()).toHaveLength(0);
  });

  it("filas escritas por el código anterior (sin cuerpo) se tratan como duplicado", async () => {
    db.seed("webhook_events", [{ event_id: "viejo", received_at: new Date().toISOString() }]);
    expect((await claimInboundEvent(db.asDb(), { eventId: "viejo", channelId: "ch-1", payload: payload() })).kind).toBe("duplicate");
  });
});

describe("guardar contacto y chat", () => {
  it("si falla, el evento se conserva con el error y el reintento de Zernio entra de inmediato", async () => {
    db.failNext.set("conversations", "upsert");
    const { claim, prepared } = await claimAndPrepare("evt-1");
    expect(prepared.ok).toBe(false);
    await releaseAfterPrepareFailure(db.asDb(), claim.row, "x");
    expect(events()[0]).toMatchObject({ status: "received", locked_until: null, last_error: "x", attempts: 1 });

    const retry = await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
    expect(retry.kind).toBe("retake");
    expect(events()[0].attempts).toBe(2);
  });

  it("tras 3 intentos fallidos pasa a 'failed' y avisa a dueño y administradores (no a los asesores)", async () => {
    db.failNext.set("conversations", "upsert");
    let { claim } = await claimAndPrepare("evt-1");
    for (let i = 1; i < MAX_INBOUND_ATTEMPTS; i++) {
      await releaseAfterPrepareFailure(db.asDb(), claim.row, `fallo ${i}`);
      expect(events()[0].status).toBe("received");
      db.failNext.set("conversations", "upsert");
      const next = await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
      if (next.kind !== "retake") throw new Error(`se esperaba retake y fue ${next.kind}`);
      await prepareInboundEvent(db.asDb(), next.row, channel);
      claim = next;
    }
    expect(events()[0].attempts).toBe(MAX_INBOUND_ATTEMPTS);
    await releaseAfterPrepareFailure(db.asDb(), claim.row, "último fallo");

    expect(events()[0]).toMatchObject({ status: "failed", last_error: "último fallo" });
    // El cuerpo se conserva para reprocesarlo a mano.
    expect(events()[0].payload).not.toBeNull();
    const notes = db.rows("notifications");
    expect(notes.map((n) => n.user_id).sort()).toEqual(["admin-1", "owner-1"]);
    expect(notes[0]).toMatchObject({ type: "inbound_failed", workspace_id: WS });
    // Zernio sigue reintentando: ya es duplicado, no se reintenta para siempre.
    expect((await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() })).kind).toBe("duplicate");
  });
});

describe("trabajo posterior (gestión, reparto, bot)", () => {
  it("al terminar queda 'processed' y se borra el cuerpo (sin datos personales de lo ya hecho)", async () => {
    const { claim } = await claimAndPrepare("evt-1");
    expect(await processStoredInbound(db.asDb(), claim.row, channel)).toBe("processed");
    expect(events()[0]).toMatchObject({ status: "processed", payload: null, last_error: null });
    expect(events()[0].processed_at).toBeTruthy();
    expect(runInboundPipeline).toHaveBeenCalledOnce();
    expect((runInboundPipeline.mock.calls[0] as unknown[])[1]).toMatchObject({
      contactId: events()[0].contact_id,
      isFirstMessage: true,
      message: { text: "Hola" },
    });
  });

  it("si falla la gestión, el evento queda pendiente y el reintento repite SOLO la gestión (nunca el bot)", async () => {
    runInboundPipeline.mockImplementationOnce(async (_db, _input, opts) => {
      const o = opts as { onFlowsStart?: () => Promise<void> };
      await o.onFlowsStart?.(); // el bot ya empezó en este intento
      return { casesOk: false, casesError: "se cayó la base" };
    });
    const { claim } = await claimAndPrepare("evt-1");
    expect(await processStoredInbound(db.asDb(), claim.row, channel)).toBe("retry");
    expect(events()[0]).toMatchObject({ status: "stored", last_error: "se cayó la base" });
    expect(events()[0].flows_started_at).toBeTruthy();
    expect(events()[0].cases_ok_at).toBeNull();
    expect(events()[0].payload).not.toBeNull();

    // El cron lo retoma cuando vence el aplazamiento.
    events()[0].locked_until = new Date(Date.now() - 1).toISOString();
    const stats = await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    expect(stats).toMatchObject({ retried: 1, recovered: 1 });
    expect(runInboundPipeline).toHaveBeenCalledTimes(2);
    expect((runInboundPipeline.mock.calls[1] as unknown[])[2]).toMatchObject({
      skipCases: false,
      skipFlows: true,
      skipAnalytics: true,
    });
    expect(events()[0]).toMatchObject({ status: "processed", payload: null });
  });

  it("si lanza una excepción, queda pendiente con el error y no se propaga", async () => {
    runInboundPipeline.mockRejectedValueOnce(new Error("explotó"));
    const { claim } = await claimAndPrepare("evt-1");
    await expect(processStoredInbound(db.asDb(), claim.row, channel)).resolves.toBe("retry");
    expect(events()[0]).toMatchObject({ status: "stored", last_error: "explotó" });
    expect(new Date(events()[0].locked_until as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("tras agotar los intentos del trabajo posterior pasa a 'failed' y avisa", async () => {
    runInboundPipeline.mockResolvedValue({ casesOk: false, casesError: "no abre" });
    const { claim } = await claimAndPrepare("evt-1");
    expect(await processStoredInbound(db.asDb(), claim.row, channel)).toBe("retry");
    for (let i = 1; i < MAX_INBOUND_ATTEMPTS; i++) {
      events()[0].locked_until = null;
      await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    }
    expect(events()[0]).toMatchObject({ status: "failed", attempts: MAX_INBOUND_ATTEMPTS });
    expect(db.rows("notifications")).toHaveLength(2);
    // Ya no se reintenta.
    const before = runInboundPipeline.mock.calls.length;
    await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    expect(runInboundPipeline.mock.calls.length).toBe(before);
  });
});

describe("barrido del cron", () => {
  it("retoma un evento cuya función se cortó antes de guardar contacto y chat", async () => {
    // Cortada justo después de reclamar: solo existe la fila 'received' con su cuerpo.
    await claimInboundEvent(db.asDb(), { eventId: "evt-1", channelId: "ch-1", payload: payload() });
    events()[0].locked_until = new Date(Date.now() - 1000).toISOString();
    expect(db.rows("contacts")).toHaveLength(0);

    const stats = await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    expect(stats).toMatchObject({ retried: 1, recovered: 1, failed: 0 });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("conversations")[0].unread_count).toBe(1);
    expect(events()[0].status).toBe("processed");
  });

  it("es idempotente: una segunda pasada no repite nada, y el evento en curso no se toca", async () => {
    await claimAndPrepare("evt-1");
    // Candado vigente (otra ejecución trabajando): el barrido lo deja.
    expect(await sweepInboundEvents(db.asDb(), { deadline: farFuture() })).toMatchObject({ retried: 0 });
    events()[0].locked_until = new Date(Date.now() - 1).toISOString();
    await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    expect(runInboundPipeline).toHaveBeenCalledOnce();
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("conversations")[0].unread_count).toBe(1);
  });

  it("dos barridos a la vez no procesan el mismo evento (la toma es condicional)", async () => {
    await claimAndPrepare("evt-1");
    events()[0].locked_until = new Date(Date.now() - 1).toISOString();
    await Promise.all([
      sweepInboundEvents(db.asDb(), { deadline: farFuture() }),
      sweepInboundEvents(db.asDb(), { deadline: farFuture() }),
    ]);
    expect(runInboundPipeline).toHaveBeenCalledOnce();
  });

  it("respeta el tope de tiempo y de lote", async () => {
    for (let i = 0; i < 4; i++) await claimAndPrepare(`evt-${i}`, payload({ platformMessageId: `w${i}`, sender: { id: `5199900000${i}`, name: "N" } }));
    for (const e of events()) e.locked_until = new Date(Date.now() - 1).toISOString();
    const stopped = await sweepInboundEvents(db.asDb(), { deadline: Date.now() - 1 });
    expect(stopped).toMatchObject({ retried: 0, stoppedEarly: true });
    const limited = await sweepInboundEvents(db.asDb(), { deadline: farFuture(), limit: 2 });
    expect(limited.retried).toBe(2);
  });

  it("dura el candado lo que debe", () => {
    expect(INBOUND_LOCK_MS).toBe(60_000);
  });
});

describe("chats con mensaje entrante sin gestión (huérfanos)", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  function chat(contactId: string, inboundAt: string) {
    db.seed("contacts", [{ id: contactId, workspace_id: WS, display_name: "X" }]);
    return db.seed("conversations", [
      { id: `cv-${contactId}`, workspace_id: WS, channel_id: "ch-1", contact_id: contactId, last_inbound_at: inboundAt },
    ])[0];
  }

  it("encola un evento por el chat sin gestión y la pasada siguiente lo recupera sin tocar el bot", async () => {
    chat("c1", minutesAgo(10));
    const found = await sweepOrphanChats(db.asDb(), { deadline: farFuture() });
    expect(found).toEqual({ found: 1, queued: 1 });
    expect(events()[0]).toMatchObject({ event_type: "orphan_chat", status: "stored", conversation_id: "cv-c1" });

    const stats = await sweepInboundEvents(db.asDb(), { deadline: farFuture() });
    expect(stats.recovered).toBe(1);
    expect((runInboundPipeline.mock.calls[0] as unknown[])[2]).toMatchObject({ skipFlows: true, skipAnalytics: true });
    expect((runInboundPipeline.mock.calls[0] as unknown[])[1]).toMatchObject({ contactId: "c1", isFirstMessage: false });
  });

  it("es idempotente: el mismo chat no se encola dos veces", async () => {
    chat("c1", minutesAgo(10));
    await sweepOrphanChats(db.asDb(), { deadline: farFuture() });
    const again = await sweepOrphanChats(db.asDb(), { deadline: farFuture() });
    expect(again.queued).toBe(0);
    expect(events()).toHaveLength(1);
  });

  it("no toca los chats cubiertos por una gestión (aunque ya esté cerrada), muy recientes o antiguos", async () => {
    chat("covered", minutesAgo(10));
    db.seed("cases", [{ workspace_id: WS, contact_id: "covered", status: "won", last_inbound_at: minutesAgo(10) }]);
    chat("fresh", minutesAgo(1));
    chat("old", minutesAgo(60 * 24));
    const result = await sweepOrphanChats(db.asDb(), { deadline: farFuture() });
    expect(result).toEqual({ found: 0, queued: 0 });
  });

  it("una gestión que una persona cerró después del mensaje ya lo atendió (no se reabre ni se responde de más)", async () => {
    chat("c3", minutesAgo(10));
    db.seed("cases", [{ workspace_id: WS, contact_id: "c3", status: "won", last_inbound_at: minutesAgo(300), closed_at: minutesAgo(8) }]);
    expect((await sweepOrphanChats(db.asDb(), { deadline: farFuture() })).queued).toBe(0);
  });

  it("una gestión sellada con un mensaje anterior no cubre el nuevo", async () => {
    chat("c2", minutesAgo(10));
    db.seed("cases", [{ workspace_id: WS, contact_id: "c2", status: "open", last_inbound_at: minutesAgo(300) }]);
    expect((await sweepOrphanChats(db.asDb(), { deadline: farFuture() })).queued).toBe(1);
  });
});

describe("poda", () => {
  it("borra lo procesado a las 48 h y lo pendiente o fallido a los 7 días", async () => {
    const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    db.seed("webhook_events", [
      { event_id: "p-old", status: "processed", received_at: hours(72) },
      { event_id: "p-new", status: "processed", received_at: hours(2) },
      { event_id: "f-3d", status: "failed", received_at: hours(72), payload: { v: 1 } },
      { event_id: "f-8d", status: "failed", received_at: hours(24 * 8), payload: { v: 1 } },
    ]);
    await pruneWebhookEvents(db.asDb());
    expect(events().map((e) => e.event_id).sort()).toEqual(["f-3d", "p-new"]);
  });
});

