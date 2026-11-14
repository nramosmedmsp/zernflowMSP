// Configuración > Estado del sistema: última ejecución de cada tarea y mensajes fallidos.

import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { isDailyCron, loadSystemStatus } from "./system-status";

let db: FakeDb;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  db = new FakeDb();
  db.seed("channels", [
    { id: "ch-1", workspace_id: "ws-1" },
    { id: "ch-x", workspace_id: "otro" },
  ]);
});

describe("loadSystemStatus", () => {
  it("marca como caída una tarea sin éxito reciente y como al día la que corrió hace poco", async () => {
    db.seed("cron_runs", [
      { name: "jobs", last_ok_at: ago(1), last_duration_ms: 800 },
      { name: "sequences", last_ok_at: ago(30), last_error_at: ago(2), last_error: "boom" },
    ]);
    const status = await loadSystemStatus(db.asDb(), "ws-1");
    const by = Object.fromEntries(status.crons.map((c) => [c.name, c]));
    expect(by.jobs.fresh).toBe(true);
    expect(by.sequences).toMatchObject({ fresh: false, lastError: "boom" });
    // Nunca corrió.
    expect(by.media_cleanup).toMatchObject({ fresh: false, lastOkAt: null });
  });

  it("lista los mensajes fallidos y pendientes de SU espacio", async () => {
    db.seed("webhook_events", [
      { event_id: "f1", status: "failed", channel_id: "ch-1", received_at: ago(60), attempts: 3, last_error: "no abre" },
      { event_id: "f-otro", status: "failed", channel_id: "ch-x", received_at: ago(60), attempts: 3 },
      { event_id: "f-viejo", status: "failed", channel_id: "ch-1", received_at: ago(60 * 24 * 9), attempts: 3 },
      { event_id: "p1", status: "stored", channel_id: "ch-1", received_at: ago(2), payload: { v: 1 } },
      { event_id: "ok", status: "processed", channel_id: "ch-1", received_at: ago(2) },
    ]);
    const status = await loadSystemStatus(db.asDb(), "ws-1");
    expect(status.failedTotal).toBe(1);
    expect(status.failedEvents).toEqual([expect.objectContaining({ eventId: "f1", attempts: 3, lastError: "no abre" })]);
    expect(status.pendingEvents).toBe(1);
  });
});

describe("isDailyCron", () => {
  it("solo las dos limpiezas son diarias", () => {
    expect(["jobs", "sequences", "media_cleanup", "retention"].filter((n) => isDailyCron(n as never))).toEqual([
      "media_cleanup",
      "retention",
    ]);
  });
});
