import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ ended: [] as unknown[], deleted: { notifications: 3, scheduled_jobs: 2 } as Record<string, number>, errors: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/cron-runs", () => ({
  recordCronStart: vi.fn(async () => {}),
  recordCronEnd: vi.fn(async (_db: unknown, name: string, r: unknown) => {
    state.ended.push([name, r]);
  }),
}));
vi.mock("@/lib/retention", () => ({
  runRetention: vi.fn(async () => ({ deleted: state.deleted, capped: false, errors: state.errors })),
}));

import { GET } from "./route";

const call = (secret?: string) =>
  GET(new NextRequest("http://localhost/api/cron/retention", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

beforeEach(() => {
  state.ended = [];
  state.errors = [];
  process.env.CRON_SECRET = "s3cret";
});

describe("GET /api/cron/retention", () => {
  it("sin la clave del cron responde 401 y no limpia nada", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("otra")).status).toBe(401);
    expect(state.ended).toHaveLength(0);
  });

  it("con la clave limpia, anota el latido sin error y devuelve los conteos", async () => {
    const res = await call("s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: { notifications: 3, scheduled_jobs: 2 }, capped: false });
    expect(state.ended).toHaveLength(1);
    expect((state.ended[0] as [string, { error: unknown }])[0]).toBe("retention");
    expect((state.ended[0] as [string, { error: unknown }])[1].error).toBeNull();
  });

  it("si una tabla falla, el latido lleva el error y responde 500", async () => {
    state.errors = ["notifications: falló"];
    const res = await call("s3cret");
    expect(res.status).toBe(500);
    expect((state.ended[0] as [string, { error: string }])[1].error).toContain("notifications");
  });
});
