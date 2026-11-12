// OPE-01: /api/health para un monitor externo. 200 {ok:true} si la base responde
// y los crons corrieron hace poco; 503 con un motivo genérico si no.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));

import { resetHealthCache } from "@/lib/health";
import { GET } from "./route";

let fake: FakeDb;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function seed(jobs: number | null, sequences: number | null) {
  const rows = [];
  if (jobs !== null) rows.push({ name: "jobs", last_ok_at: minutesAgo(jobs) });
  if (sequences !== null) rows.push({ name: "sequences", last_ok_at: minutesAgo(sequences) });
  fake.seed("cron_runs", rows);
}

beforeEach(() => {
  resetHealthCache();
  fake = new FakeDb();
  state.db = fake;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/health", () => {
  it("200 {ok:true} con la base respondiendo y los crons al día, sin caché y sin datos de más", async () => {
    seed(1, 2);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("503 cron_jobs si /api/cron/jobs no terminó bien en 5 minutos", async () => {
    seed(6, 1);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "cron_jobs" });
  });

  it("503 cron_secuencias si las secuencias están paradas", async () => {
    seed(1, 9);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "cron_secuencias" });
  });

  it("503 si un cron nunca corrió (tabla vacía)", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("cron_jobs");
  });

  it("503 base si la consulta falla, sin filtrar el error", async () => {
    seed(1, 1);
    fake.failNext.set("cron_runs", "select");
    resetHealthCache();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "base" });
  });

  it("503 base si la base lanza una excepción", async () => {
    state.db = {
      from() {
        throw new Error("connection refused 10.0.0.5");
      },
    };
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/10\.0|refused/);
  });

  it("no se puede usar para cargar la base: llamadas seguidas comparten una sola consulta", async () => {
    seed(1, 1);
    const spy = vi.spyOn(fake, "from");
    await Promise.all([GET(), GET(), GET()]);
    await GET();
    await GET();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
