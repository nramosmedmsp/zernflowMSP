// Pausar, reanudar y cancelar una difusión: reglas, registro y carreras con el cron.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import {
  BROADCAST_CANCELLED_RECIPIENT_MESSAGE,
  cancelBroadcast,
  loadBroadcastProgress,
  pauseBroadcast,
  resumeBroadcast,
} from "./control";

const WS = "ws-1";
const ACTOR = "u-owner";
let fake: FakeDb;
let id: string;

const params = (over: Partial<{ workspaceId: string; broadcastId: string }> = {}) => ({
  workspaceId: WS,
  broadcastId: id,
  actorId: ACTOR,
  ...over,
});
const broadcast = () => fake.rows("broadcasts").find((b) => b.id === id)!;
const statuses = () => fake.rows("broadcast_recipients").map((r) => r.status).sort();
const audits = () => fake.rows("activity").filter((a) => (a.meta as { entity?: string }).entity === "broadcast");

function recipients(spec: Record<string, number>, broadcastId = id) {
  let n = 0;
  for (const [status, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) {
      fake.seed("broadcast_recipients", [{ broadcast_id: broadcastId, contact_id: `c-${broadcastId}-${n++}`, channel_id: "ch", status }]);
    }
  }
}

beforeEach(() => {
  fake = new FakeDb();
  const [b] = fake.seed("broadcasts", [
    { workspace_id: WS, name: "Promo", status: "sending", message_content: {}, total_recipients: 10, sent: 0, failed: 0, consecutive_failures: 0 },
  ]);
  id = b.id as string;
});

describe("pausar", () => {
  it("pasa de enviándose a en pausa, anota quién y cuántos van, y no toca a los destinatarios", async () => {
    recipients({ sent: 3, pending: 6, sending: 1 });
    const res = await pauseBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, changed: true, status: "paused", progress: { sent: 3, pending: 6, sending: 1 } });
    expect(broadcast()).toMatchObject({ status: "paused", paused_reason: "manual" });
    expect(broadcast().paused_at).toBeTruthy();
    expect(statuses().filter((s) => s === "pending")).toHaveLength(6);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      type: "config_changed",
      actor_id: ACTOR,
      meta: { action: "broadcast_paused", broadcast_id: id, sent: 3, pending: 6, in_flight: 1 },
    });
  });

  it("pausar dos veces no falla ni duplica el registro", async () => {
    recipients({ sent: 1, pending: 1 });
    await pauseBroadcast(fake.asDb(), params());
    const again = await pauseBroadcast(fake.asDb(), params());
    expect(again).toMatchObject({ ok: true, changed: false, status: "paused" });
    expect(audits()).toHaveLength(1);
  });

  it("no se puede pausar una difusión terminada, cancelada o en borrador", async () => {
    for (const [status, phrase] of [
      ["completed", "terminada"],
      ["cancelled", "cancelada"],
      ["draft", "en borrador"],
    ] as const) {
      broadcast().status = status;
      const res = await pauseBroadcast(fake.asDb(), params());
      expect(res).toEqual({ ok: false, status: 409, error: `No se puede pausar una difusión ${phrase}.` });
    }
    expect(audits()).toHaveLength(0);
  });

  it("una difusión de otro espacio o inexistente responde 404 y no cambia nada", async () => {
    expect(await pauseBroadcast(fake.asDb(), params({ workspaceId: "otro" }))).toMatchObject({ ok: false, status: 404 });
    expect(await pauseBroadcast(fake.asDb(), params({ broadcastId: "no-existe" }))).toMatchObject({ ok: false, status: 404 });
    expect(broadcast().status).toBe("sending");
  });

  it("si la base falla responde un mensaje claro, sin detalle técnico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.failNext.set("broadcasts", "update");
    const res = await pauseBroadcast(fake.asDb(), params());
    expect(res).toEqual({ ok: false, status: 500, error: "No se pudo completar la operación. Inténtalo de nuevo." });
    expect(broadcast().status).toBe("sending");
  });
});

describe("reanudar", () => {
  beforeEach(() => {
    broadcast().status = "paused";
    broadcast().paused_reason = "auto_failures";
    broadcast().pause_note = "Se pausó sola";
    broadcast().consecutive_failures = 10;
  });

  it("vuelve a enviándose, limpia la pausa y los fallos seguidos, y deja los pendientes como estaban", async () => {
    recipients({ sent: 4, pending: 5, failed: 1 });
    const res = await resumeBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, changed: true, status: "sending" });
    expect(broadcast()).toMatchObject({ status: "sending", paused_reason: null, pause_note: null, consecutive_failures: 0 });
    expect(statuses().filter((s) => s === "pending")).toHaveLength(5);
    expect(audits()[0].meta).toMatchObject({ action: "broadcast_resumed", sent: 4, pending: 5 });
  });

  it("si en la pausa ya no quedaba nada por enviar, la difusión termina", async () => {
    recipients({ sent: 5, failed: 1 });
    const res = await resumeBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, status: "completed" });
    expect(broadcast().status).toBe("completed");
  });

  it("una difusión cancelada no se puede reanudar", async () => {
    broadcast().status = "cancelled";
    const res = await resumeBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("no se puede reanudar") });
    expect(broadcast().status).toBe("cancelled");
  });

  it("una difusión terminada o sin enviar tampoco", async () => {
    broadcast().status = "completed";
    expect(await resumeBroadcast(fake.asDb(), params())).toMatchObject({ ok: false, status: 409 });
    broadcast().status = "draft";
    expect(await resumeBroadcast(fake.asDb(), params())).toMatchObject({ ok: false, status: 409 });
  });

  it("reanudar una que ya se está enviando no falla ni repite el registro", async () => {
    broadcast().status = "sending";
    expect(await resumeBroadcast(fake.asDb(), params())).toMatchObject({ ok: true, changed: false });
    expect(audits()).toHaveLength(0);
  });
});

describe("cancelar", () => {
  it("los pendientes quedan «cancelado» (no «fallido»), lo ya enviado queda enviado y se anota", async () => {
    recipients({ sent: 3, pending: 6, failed: 1 });
    const res = await cancelBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, changed: true, status: "cancelled", progress: { sent: 3, cancelled: 6, failed: 1, pending: 0 } });
    expect(broadcast()).toMatchObject({ status: "cancelled" });
    expect(broadcast().cancelled_at).toBeTruthy();
    expect(fake.rows("broadcast_recipients").filter((r) => r.status === "cancelled").every((r) => r.error_message === BROADCAST_CANCELLED_RECIPIENT_MESSAGE)).toBe(true);
    expect(fake.rows("broadcast_recipients").filter((r) => r.status === "failed")).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ actor_id: ACTOR, meta: { action: "broadcast_cancelled", sent: 3, cancelled: 6 } });
  });

  it("también desde una pausa o una programada, y no toca a quien el cron ya estaba enviando", async () => {
    recipients({ sent: 1, pending: 2, sending: 1 });
    broadcast().status = "paused";
    const res = await cancelBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, progress: { sending: 1, cancelled: 2 } });
    broadcast().status = "scheduled";
    broadcast().cancelled_at = null;
    expect(await cancelBroadcast(fake.asDb(), params())).toMatchObject({ ok: true, status: "cancelled" });
  });

  it("no se puede cancelar una difusión terminada ni un borrador", async () => {
    broadcast().status = "completed";
    expect(await cancelBroadcast(fake.asDb(), params())).toEqual({ ok: false, status: 409, error: "No se puede cancelar una difusión terminada." });
    broadcast().status = "draft";
    expect(await cancelBroadcast(fake.asDb(), params())).toMatchObject({ ok: false, status: 409 });
  });

  it("repetir «Cancelar» termina el barrido si el intento anterior se cortó, sin duplicar el registro", async () => {
    recipients({ sent: 1, pending: 3 });
    broadcast().status = "cancelled";
    const res = await cancelBroadcast(fake.asDb(), params());
    expect(res).toMatchObject({ ok: true, changed: false, progress: { cancelled: 3, pending: 0 } });
    expect(audits()).toHaveLength(0);
  });

  it("si falla el barrido de pendientes avisa; la difusión ya no envía y repetir lo termina", async () => {
    recipients({ pending: 3 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.failNext.set("broadcast_recipients", "update");
    const first = await cancelBroadcast(fake.asDb(), params());
    expect(first).toMatchObject({ ok: false, status: 500 });
    expect(broadcast().status).toBe("cancelled");
    const second = await cancelBroadcast(fake.asDb(), params());
    expect(second).toMatchObject({ ok: true, progress: { cancelled: 3 } });
  });

  it("no toca a los destinatarios de otras difusiones y borra trabajos de envío viejos", async () => {
    recipients({ pending: 2 });
    recipients({ pending: 2 }, "otra");
    fake.seed("scheduled_jobs", [
      { type: "send_broadcast", status: "pending", payload: { broadcastId: id, recipientId: "x" } },
      { type: "send_broadcast", status: "pending", payload: { broadcastId: "otra", recipientId: "y" } },
    ]);
    await cancelBroadcast(fake.asDb(), params());
    expect(fake.rows("broadcast_recipients").filter((r) => r.broadcast_id === "otra").every((r) => r.status === "pending")).toBe(true);
    expect(fake.rows("scheduled_jobs")).toHaveLength(1);
  });
});

describe("avance", () => {
  it("cuenta cada estado", async () => {
    recipients({ pending: 2, sending: 1, sent: 4, skipped: 1, failed: 1, cancelled: 3 });
    expect(await loadBroadcastProgress(fake.asDb(), id)).toEqual({ total: 12, pending: 2, sending: 1, sent: 4, skipped: 1, failed: 1, cancelled: 3 });
  });
});
