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

  it("guarda el número de filas cuando llega como entero razonable", async () => {
    await recordDataExport("metricas-volumen.csv", 30);
    await recordDataExport("metricas-motivos.csv", -1);
    await recordDataExport("metricas-embudo.csv", "9" as never);
    const rows = fake.rows("activity").map((a) => a.meta as Record<string, unknown>);
    expect(rows[0]).toMatchObject({ file: "metricas-volumen.csv", rows: 30 });
    expect(rows[1]).not.toHaveProperty("rows");
    expect(rows[2]).not.toHaveProperty("rows");
  });

  it("ignora nombres raros que mande el navegador", async () => {
    for (const bad of ["../../etc/passwd", "a b.csv", "", "x".repeat(200), 5 as never, "<img src=x>.csv"]) {
      await recordDataExport(bad);
    }
    expect(fake.rows("activity")).toHaveLength(0);
  });
});
