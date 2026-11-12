// Señal de vida y tope de tiempo del cron de secuencias (OPE-01, CONF-03).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, run: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/sequence-processor", () => ({ processSequenceSteps: state.run }));

import { GET, maxDuration } from "./route";

const original = process.env.CRON_SECRET;
let fake: FakeDb;
const get = (headers: Record<string, string> = {}) => GET(new NextRequest("http://x/api/cron/sequences", { headers }));

beforeEach(() => {
  process.env.CRON_SECRET = "secreto";
  fake = new FakeDb();
  state.db = fake;
  state.run.mockReset();
  state.run.mockResolvedValue({ processed: 2, failed: 0, total: 2, skippedForTime: 0 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/sequences", () => {
  it("declara su duración máxima y le pasa un plazo propio al procesador", async () => {
    expect(maxDuration).toBe(60);
    const before = Date.now();
    await get({ authorization: "Bearer secreto" });
    const { deadline } = state.run.mock.calls[0][0] as { deadline: number };
    expect(deadline - before).toBeGreaterThan(30_000);
    expect(deadline - before).toBeLessThanOrEqual(35_100);
  });

  it("anota inicio, fin correcto y conteos en cron_runs", async () => {
    const res = await get({ authorization: "Bearer secreto" });
    expect(res.status).toBe(200);
    const row = fake.rows("cron_runs").find((r) => r.name === "sequences");
    expect(row?.last_started_at).toBeTruthy();
    expect(row?.last_ok_at).toBeTruthy();
    expect(row?.last_stats).toMatchObject({ processed: 2 });
  });

  it("si el procesador falla, responde 500 genérico y anota el error sin marcar el fin correcto", async () => {
    state.run.mockRejectedValueOnce(new Error("detalle interno"));
    const res = await get({ authorization: "Bearer secreto" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    const row = fake.rows("cron_runs").find((r) => r.name === "sequences");
    expect(row?.last_error).toBe("detalle interno");
    expect(row?.last_ok_at).toBeUndefined();
  });

  it("sin la clave responde 401 y no anota nada", async () => {
    expect((await get()).status).toBe(401);
    expect(fake.rows("cron_runs")).toHaveLength(0);
  });
});
