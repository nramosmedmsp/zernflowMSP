// B-23: la tarea automática que ejecuta los envíos programados. Sin la clave
// no hace nada; con ella, un trabajo que ya venció se ejecuta una sola vez.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));

import { GET } from "./route";

const original = process.env.CRON_SECRET;
let fake: FakeDb;

const get = (headers: Record<string, string> = {}, query = "") =>
  GET(new NextRequest(`http://x/api/cron/jobs${query}`, { headers }));

beforeEach(() => {
  process.env.CRON_SECRET = "secreto";
  fake = new FakeDb();
  state.db = fake;
});
afterEach(() => {
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
    await get({}, "?key=secreto");
    expect(fake.rows("webhook_events").map((e) => e.id)).toEqual(["new"]);
  });
});
