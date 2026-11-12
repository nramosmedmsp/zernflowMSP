// B-23: la tarea automática que ejecuta los envíos programados. Sin la clave
// no hace nada; con ella, un trabajo que ya venció se ejecuta una sola vez.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, order: [] as string[], caseDeadlines: [] as number[] }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
// Las tareas de gestiones corren de verdad; solo se anota cuándo y con qué plazo.
vi.mock("@/lib/cases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cases")>();
  return {
    ...actual,
    runCaseTasks: async (db: Parameters<typeof actual.runCaseTasks>[0], opts: Parameters<typeof actual.runCaseTasks>[1]) => {
      state.order.push("cases");
      state.caseDeadlines.push(opts.deadline);
      return actual.runCaseTasks(db, opts);
    },
  };
});

import { GET } from "./route";

const original = process.env.CRON_SECRET;
let fake: FakeDb;

const get = (headers: Record<string, string> = {}, query = "") =>
  GET(new NextRequest(`http://x/api/cron/jobs${query}`, { headers }));

beforeEach(() => {
  process.env.CRON_SECRET = "secreto";
  fake = new FakeDb();
  state.db = fake;
  state.order = [];
  state.caseDeadlines = [];
});
afterEach(() => {
  vi.useRealTimers();
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/jobs", () => {
  it("sin la clave (o con otra) responde 401 y no toca los trabajos", async () => {
    fake.seed("scheduled_jobs", [{ id: "j1", status: "pending", run_at: "2020-01-01T00:00:00Z", attempts: 0, type: "unknown" }]);
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: "Bearer otra" })).status).toBe(401);
    expect(fake.rows("scheduled_jobs")[0].status).toBe("pending");
  });

  it("con la clave y sin trabajos pendientes responde bien", async () => {
    const res = await get({ authorization: "Bearer secreto" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 0 });
  });

  it("borra los avisos de webhook de más de 48 horas", async () => {
    fake.seed("webhook_events", [
      { id: "old", received_at: new Date(Date.now() - 72 * 3600_000).toISOString() },
      { id: "new", received_at: new Date().toISOString() },
    ]);
    await get({ authorization: "Bearer secreto" });
    expect(fake.rows("webhook_events").map((e) => e.id)).toEqual(["new"]);
  });

  it("poda la bandeja de webhooks: procesados a las 48 h, pendientes o fallidos a los 7 días", async () => {
    const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    fake.seed("webhook_events", [
      { event_id: "p-old", status: "processed", received_at: hours(72) },
      { event_id: "f-3d", status: "failed", received_at: hours(72), payload: { v: 1 } },
      { event_id: "f-8d", status: "failed", received_at: hours(24 * 8), payload: { v: 1 } },
    ]);
    await get({ authorization: "Bearer secreto" });
    expect(fake.rows("webhook_events").map((e) => e.event_id)).toEqual(["f-3d"]);
  });

  // OPE-01: señal de vida.
  it("anota su ejecución en cron_runs (inicio, fin correcto, duración)", async () => {
    await get({ authorization: "Bearer secreto" });
    const row = fake.rows("cron_runs").find((r) => r.name === "jobs");
    expect(row).toBeDefined();
    expect(row?.last_started_at).toBeTruthy();
    expect(row?.last_ok_at).toBeTruthy();
    expect(row?.last_error).toBeUndefined();
    expect(typeof row?.last_duration_ms).toBe("number");
  });

  it("si la lectura de trabajos falla, responde 500 y anota el error (no el fin correcto)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.failNext.set("scheduled_jobs", "select");
    const res = await get({ authorization: "Bearer secreto" });
    expect(res.status).toBe(500);
    const row = fake.rows("cron_runs").find((r) => r.name === "jobs");
    expect(row?.last_error).toBe("Failed to fetch jobs");
    expect(row?.last_ok_at).toBeUndefined();
  });

  it("sin Authorization no anota nada", async () => {
    await get();
    expect(fake.rows("cron_runs")).toHaveLength(0);
  });

  // CONF-03: una cola lenta no deja sin correr las tareas de gestiones.
  it("con una cola lenta de envíos, las tareas de gestiones corren primero y la cola se corta a tiempo", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-10T15:00:00Z") });
    const past = new Date(Date.now() - 60_000).toISOString();
    fake.seed(
      "scheduled_jobs",
      Array.from({ length: 20 }, (_, i) => ({ id: `j${i}`, type: `lento-${i}`, status: "pending", attempts: 0, run_at: past, payload: {} })),
    );
    // Cada trabajo "tarda" 20 s (un envío a Zernio lento): al completarse avanza el reloj.
    const original = fake.from.bind(fake);
    vi.spyOn(fake, "from").mockImplementation(((table: string) => {
      const q = original(table) as unknown as { update: (patch: Record<string, unknown>) => unknown };
      if (table !== "scheduled_jobs") return q;
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop !== "update") return Reflect.get(target, prop, receiver);
          return (patch: Record<string, unknown>) => {
            if (patch.status === "completed") state.order.push("job");
            if (patch.status === "completed") vi.setSystemTime(Date.now() + 20_000);
            return target.update(patch);
          };
        },
      });
    }) as typeof fake.from);

    const started = Date.now();
    const res = await get({ authorization: "Bearer secreto" });
    const body = await res.json();

    // Gestiones primero, con su propio tope (≤ 15 s), antes de cualquier trabajo.
    expect(state.order[0]).toBe("cases");
    expect(state.caseDeadlines[0] - started).toBeLessThanOrEqual(15_000);
    // No se empieza un trabajo nuevo pasados 35 s: con 20 s cada uno entran 2 y el resto espera.
    expect(body.processed).toBe(2);
    expect(body.skippedForTime).toBe(18);
    expect(fake.rows("scheduled_jobs").filter((j) => j.status === "pending")).toHaveLength(18);
    expect(res.status).toBe(200);
  });

  it("los envíos de difusión no van delante de las esperas de flujos", async () => {
    const past = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    fake.seed("scheduled_jobs", [
      // Vencidos antes (más viejos) pero de difusión.
      ...Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, type: "send_broadcast", status: "pending", attempts: 0, run_at: past(600 - i), payload: {} })),
      { id: "espera", type: "otro", status: "pending", attempts: 0, run_at: past(10), payload: {} },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const order: string[] = [];
    const original = fake.from.bind(fake);
    vi.spyOn(fake, "from").mockImplementation(((table: string) => {
      const q = original(table) as unknown as { update: (patch: Record<string, unknown>) => { eq: (c: string, v: unknown) => unknown } };
      if (table !== "scheduled_jobs") return q;
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop !== "update") return Reflect.get(target, prop, receiver);
          return (patch: Record<string, unknown>) => {
            const chain = target.update(patch);
            if (patch.status === "processing") {
              return new Proxy(chain as object, {
                get(t, p, r) {
                  if (p !== "eq") return Reflect.get(t, p, r);
                  return (c: string, v: unknown) => {
                    if (c === "id") order.push(String(v));
                    return (t as { eq: (c: string, v: unknown) => unknown }).eq(c, v);
                  };
                },
              });
            }
            return chain;
          };
        },
      });
    }) as typeof fake.from);
    await get({ authorization: "Bearer secreto" });
    expect(order[0]).toBe("espera");
  });
});
