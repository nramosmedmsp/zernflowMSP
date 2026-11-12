// La parte de difusiones del cron: ritmo, pausa, cancelación sin carreras y corte
// automático ante fallos seguidos.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { cancelBroadcast, pauseBroadcast, resumeBroadcast } from "./control";
import type { DeliveryResult } from "./delivery";
import { BROADCAST_INTERRUPTED_MESSAGE, runBroadcastSendPass, type DeliverFn } from "./send-pass";

const WS = "ws-1";
let fake: FakeDb;
let id: string;
const delivered: string[] = [];

const OK: DeliveryResult = { ok: true, messageId: "m" };
const GENERAL: DeliveryResult = { ok: false, error: "Zernio rechazó el mensaje", general: true };
const INDIVIDUAL: DeliveryResult = { ok: false, error: "El contacto no tiene un número de WhatsApp" };
const SKIPPED: DeliveryResult = { ok: false, skipped: true, error: "Omitido: el cliente se dio de baja de la publicidad." };

/** Envío de mentira: anota a quién se le envió y responde según `answer`. */
function sender(answer: (contactId: string, nth: number) => DeliveryResult | Promise<DeliveryResult> = () => OK): DeliverFn {
  return async (_db, p) => {
    delivered.push(p.contactId);
    return answer(p.contactId, delivered.length);
  };
}

const pass = (deliver: DeliverFn, over: Partial<Parameters<typeof runBroadcastSendPass>[1]> = {}) =>
  runBroadcastSendPass(fake.asDb(), { deadline: Date.now() + 30_000, concurrency: 1, deliver, ...over });

const broadcast = (bid = id) => fake.rows("broadcasts").find((b) => b.id === bid)!;
const recipient = (contactId: string) => fake.rows("broadcast_recipients").find((r) => r.contact_id === contactId)!;
const count = (status: string, bid = id) => fake.rows("broadcast_recipients").filter((r) => r.broadcast_id === bid && r.status === status).length;

function addRecipients(n: number, bid = id, prefix = "c") {
  fake.seed(
    "broadcast_recipients",
    Array.from({ length: n }, (_, i) => ({ broadcast_id: bid, contact_id: `${prefix}${i + 1}`, channel_id: "ch", status: "pending" })),
  );
}

beforeEach(() => {
  fake = new FakeDb();
  delivered.length = 0;
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: "u-owner", role: "owner" },
    { workspace_id: WS, user_id: "u-admin", role: "admin" },
    { workspace_id: WS, user_id: "u-member", role: "member" },
  ]);
  const [b] = fake.seed("broadcasts", [
    { workspace_id: WS, name: "Promo de verano", status: "sending", message_content: { kind: "text", text: "Hola" }, total_recipients: 0, sent: 0, delivered: 0, failed: 0, consecutive_failures: 0 },
  ]);
  id = b.id as string;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("ritmo", () => {
  it("envía como mucho el tope de la pasada y la siguiente sigue con los demás, sin repetir a nadie", async () => {
    addRecipients(5);
    const first = await pass(sender(), { maxSends: 2 });
    expect(first).toMatchObject({ attempted: 2, sent: 2 });
    expect(count("pending")).toBe(3);
    await pass(sender(), { maxSends: 2 });
    const last = await pass(sender(), { maxSends: 2 });
    expect(last.attempted).toBe(1);
    expect(delivered.sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(broadcast()).toMatchObject({ status: "completed", sent: 5, failed: 0 });
    expect(count("sent")).toBe(5);
  });

  it("con varios envíos a la vez no pasa de la concurrencia pedida", async () => {
    addRecipients(8);
    let inFlight = 0;
    let peak = 0;
    await pass(
      sender(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return OK;
      }),
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
    expect(delivered).toHaveLength(8);
  });

  it("con el plazo vencido no empieza ningún envío y todo queda pendiente", async () => {
    addRecipients(3);
    const res = await pass(sender(), { deadline: Date.now() - 1 });
    expect(res.attempted).toBe(0);
    expect(delivered).toHaveLength(0);
    expect(count("pending")).toBe(3);
  });

  it("reparte la porción de la pasada entre difusiones, la más antigua primero", async () => {
    addRecipients(3);
    const [b2] = fake.seed("broadcasts", [
      { workspace_id: WS, name: "Otra", status: "sending", message_content: { kind: "text", text: "Hola" }, consecutive_failures: 0, created_at: "2999-01-01T00:00:00Z" },
    ]);
    addRecipients(3, b2.id as string, "d");
    await pass(sender(), { maxSends: 4 });
    expect(delivered).toEqual(["c1", "c2", "c3", "d1"]);
  });

  it("no toca las difusiones en pausa, canceladas o en borrador", async () => {
    addRecipients(2);
    for (const status of ["paused", "cancelled", "draft", "completed"]) {
      broadcast().status = status;
      await pass(sender());
    }
    expect(delivered).toHaveLength(0);
    expect(count("pending")).toBe(2);
  });

  it("dos pasadas a la vez no envían dos veces al mismo contacto", async () => {
    addRecipients(6);
    await Promise.all([pass(sender(), { concurrency: 3 }), pass(sender(), { concurrency: 3 })]);
    expect(delivered.sort()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(count("sent")).toBe(6);
    expect(broadcast().sent).toBe(6);
  });
});

describe("resultados", () => {
  it("el consentimiento omitido queda «omitido», no cuenta como fallo y no corta la difusión", async () => {
    addRecipients(3);
    const res = await pass(sender((c) => (c === "c2" ? SKIPPED : OK)));
    expect(res).toMatchObject({ sent: 2, skipped: 1, failed: 0 });
    expect(recipient("c2")).toMatchObject({ status: "skipped", error_message: SKIPPED.ok ? "" : SKIPPED.error });
    expect(broadcast()).toMatchObject({ status: "completed", sent: 2, failed: 0 });
  });

  it("un fallo del contacto lo deja fallido con su motivo y cuenta en la difusión", async () => {
    addRecipients(2);
    await pass(sender((c) => (c === "c1" ? INDIVIDUAL : OK)));
    expect(recipient("c1")).toMatchObject({ status: "failed", error_message: "El contacto no tiene un número de WhatsApp" });
    expect(broadcast()).toMatchObject({ sent: 1, failed: 1, status: "completed" });
  });

  it("si el envío lanza un error inesperado, el destinatario queda fallido con un motivo en español", async () => {
    addRecipients(1);
    await pass(async () => {
      throw new Error("ECONNRESET");
    });
    expect(recipient("c1")).toMatchObject({ status: "failed", error_message: expect.stringContaining("error inesperado") });
    expect(recipient("c1").status).not.toBe("sending");
  });

  it("nunca deja a nadie «enviándose» al terminar", async () => {
    addRecipients(6);
    await pass(sender((c) => (c === "c3" ? GENERAL : OK)));
    expect(count("sending")).toBe(0);
    expect(count("pending")).toBe(0);
  });
});

describe("pausar sin carreras", () => {
  it("pausar mientras el cron envía: lo que ya salía termina bien, los demás esperan y ninguno queda a medias", async () => {
    addRecipients(6);
    await pass(
      sender(async (c) => {
        // Una persona pulsa «Pausar» justo mientras se envía al segundo.
        if (c === "c2") await pauseBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
        return OK;
      }),
    );
    expect(delivered).toEqual(["c1", "c2"]);
    expect(count("sent")).toBe(2);
    expect(count("pending")).toBe(4);
    expect(count("sending")).toBe(0);
    expect(broadcast().status).toBe("paused");

    // Otra pasada en pausa no envía nada.
    await pass(sender());
    expect(delivered).toHaveLength(2);
  });

  it("reanudar sigue con los pendientes, sin repetir a nadie", async () => {
    addRecipients(5);
    await pass(sender(), { maxSends: 2 });
    await pauseBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
    await pass(sender());
    expect(delivered).toEqual(["c1", "c2"]);
    await resumeBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
    await pass(sender());
    expect(delivered).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(broadcast()).toMatchObject({ status: "completed", sent: 5 });
  });

  it("con varios envíos a la vez, pausar corta los que aún no empezaban", async () => {
    addRecipients(10);
    await pass(
      sender(async (c) => {
        if (c === "c1") await pauseBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
        await new Promise((r) => setTimeout(r, 2));
        return OK;
      }),
      { concurrency: 3 },
    );
    // A lo más los 3 que ya iban en vuelo; el resto queda pendiente.
    expect(delivered.length).toBeLessThanOrEqual(3);
    expect(count("sent")).toBe(delivered.length);
    expect(count("pending")).toBe(10 - delivered.length);
    expect(count("sending")).toBe(0);
  });
});

describe("cancelar sin carreras", () => {
  it("cancelar mientras el cron envía: el que iba en vuelo termina, los demás quedan cancelados, ninguno intermedio", async () => {
    addRecipients(6);
    await pass(
      sender(async (c) => {
        if (c === "c2") await cancelBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
        return OK;
      }),
    );
    expect(delivered).toEqual(["c1", "c2"]);
    expect(count("sent")).toBe(2);
    expect(count("cancelled")).toBe(4);
    expect(count("pending") + count("sending")).toBe(0);
    // Cancelada, no «terminada»: la pasada no la pisa.
    expect(broadcast().status).toBe("cancelled");
    expect(broadcast().failed).toBe(0);
  });

  it("si la cancelación llega justo entre leer el estado y tomar al destinatario, a ese no se le envía", async () => {
    addRecipients(4);
    let armed = true;
    // Justo antes de que el cron tome a c2, la cancelación ya confirmó (misma operación que cancelBroadcast).
    fake.beforeUpdate = () => {
      const next = fake.rows("broadcast_recipients").find((r) => r.contact_id === "c2");
      if (!armed || delivered.length !== 1 || !next || next.status !== "pending") return;
      armed = false;
      broadcast().status = "cancelled";
      fake.rows("broadcast_recipients").filter((r) => r.status === "pending").forEach((r) => (r.status = "cancelled"));
    };
    await pass(sender());
    expect(delivered).toEqual(["c1"]);
    expect(recipient("c2").status).toBe("cancelled");
    expect(count("sending")).toBe(0);
  });

  it("después de cancelar ninguna pasada envía nada más", async () => {
    addRecipients(4);
    await pass(sender(), { maxSends: 1 });
    await cancelBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
    await pass(sender());
    await pass(sender());
    expect(delivered).toEqual(["c1"]);
    expect(count("cancelled")).toBe(3);
  });
});

describe("corte automático ante fallos seguidos", () => {
  beforeEach(() => addRecipients(14));

  it("tras 10 fallos generales seguidos se pausa sola, deja el resto pendiente y avisa al Dueño y Administradores", async () => {
    const res = await pass(sender(() => GENERAL));
    expect(res.autoPaused).toEqual([id]);
    expect(delivered).toHaveLength(10);
    expect(count("failed")).toBe(10);
    expect(count("pending")).toBe(4);
    expect(broadcast()).toMatchObject({ status: "paused", paused_reason: "auto_failures", consecutive_failures: 10 });
    expect(String(broadcast().pause_note)).toContain("10 envíos seguidos fallaron");

    const notes = fake.rows("notifications");
    expect(notes.map((n) => n.user_id).sort()).toEqual(["u-admin", "u-owner"]);
    expect(notes[0]).toMatchObject({ type: "broadcast_paused", title: "Una difusión se pausó sola" });
    expect(String(notes[0].body)).toContain("Promo de verano");
    expect(String(notes[0].link)).toContain(id);

    expect(fake.rows("activity").find((a) => (a.meta as { action?: string }).action === "broadcast_auto_paused")).toMatchObject({ actor_id: null });

    // Y ya no sigue enviando.
    await pass(sender(() => GENERAL));
    expect(delivered).toHaveLength(10);
  });

  it("los fallos que dependen del contacto no pausan la difusión", async () => {
    const res = await pass(sender(() => INDIVIDUAL));
    expect(res.autoPaused).toEqual([]);
    expect(delivered).toHaveLength(14);
    expect(broadcast().status).toBe("completed");
  });

  it("un envío bueno reinicia la cuenta de fallos seguidos", async () => {
    // 9 fallos, 1 bueno, 4 fallos: nunca 10 seguidos.
    const res = await pass(sender((_c, nth) => (nth === 10 ? OK : GENERAL)));
    expect(res.autoPaused).toEqual([]);
    expect(broadcast().status).toBe("completed");
  });

  it("la cuenta sigue entre pasadas", async () => {
    await pass(sender(() => GENERAL), { maxSends: 6 });
    expect(broadcast()).toMatchObject({ status: "sending", consecutive_failures: 6 });
    const second = await pass(sender(() => GENERAL), { maxSends: 6 });
    expect(second.autoPaused).toEqual([id]);
    expect(delivered).toHaveLength(10);
  });

  it("al reanudar la cuenta empieza de cero y sigue con los pendientes", async () => {
    await pass(sender(() => GENERAL));
    await resumeBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
    expect(broadcast().consecutive_failures).toBe(0);
    const res = await pass(sender());
    expect(res).toMatchObject({ sent: 4, autoPaused: [] });
    expect(broadcast().status).toBe("completed");
  });

  it("con varios envíos a la vez también corta, a lo más con unos pocos de más ya en vuelo", async () => {
    await pass(sender(() => GENERAL), { concurrency: 4 });
    expect(broadcast().status).toBe("paused");
    expect(delivered.length).toBeLessThanOrEqual(10 + 3);
    expect(count("sending")).toBe(0);
  });

  it("si una persona la pausó justo antes, no se duplica el aviso", async () => {
    await pass(
      sender(async (_c, nth) => {
        if (nth === 10) await pauseBroadcast(fake.asDb(), { workspaceId: WS, broadcastId: id, actorId: "u-owner" });
        return GENERAL;
      }),
    );
    expect(broadcast().paused_reason).toBe("manual");
    expect(fake.rows("notifications")).toHaveLength(0);
  });
});

describe("envíos cortados", () => {
  it("un envío que quedó «enviándose» hace más de 5 minutos pasa a fallido (no se reenvía) y la difusión termina", async () => {
    fake.seed("broadcast_recipients", [
      { broadcast_id: id, contact_id: "viejo", channel_id: "ch", status: "sending", claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() },
    ]);
    const res = await pass(sender());
    expect(res.interrupted).toBe(1);
    expect(recipient("viejo")).toMatchObject({ status: "failed", error_message: BROADCAST_INTERRUPTED_MESSAGE });
    expect(delivered).toHaveLength(0);
    expect(broadcast()).toMatchObject({ failed: 1, status: "completed" });
  });

  it("uno que lleva poco tiempo enviándose no se toca", async () => {
    fake.seed("broadcast_recipients", [
      { broadcast_id: id, contact_id: "reciente", channel_id: "ch", status: "sending", claimed_at: new Date(Date.now() - 60_000).toISOString() },
    ]);
    const res = await pass(sender());
    expect(res.interrupted).toBe(0);
    expect(recipient("reciente").status).toBe("sending");
    expect(broadcast().status).toBe("sending");
  });
});
