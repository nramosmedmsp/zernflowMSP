import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "u1" }, workspace: { id: "ws-1" }, role: "admin" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.fake }));

import { recordDataExport } from "./audit";

let fake: FakeDb;
beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
});

describe("recordDataExport", () => {
  it("deja una fila con quién exportó y qué archivo", async () => {
    await recordDataExport("metricas-asesores.csv");
    expect(fake.rows("activity")).toHaveLength(1);
    expect(fake.rows("activity")[0]).toMatchObject({
      type: "config_changed",
      actor_id: "u1",
      workspace_id: "ws-1",
      to_value: "metricas-asesores.csv",
      meta: { action: "data_exported", entity: "export", file: "metricas-asesores.csv" },
    });
  });

  it("ignora nombres raros que mande el navegador", async () => {
    for (const bad of ["../../etc/passwd", "a b.csv", "", "x".repeat(200), 5 as never, "<img src=x>.csv"]) {
      await recordDataExport(bad);
    }
    expect(fake.rows("activity")).toHaveLength(0);
  });
});
