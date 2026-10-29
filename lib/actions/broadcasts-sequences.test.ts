// Acciones de difusiones y secuencias: permisos, filtros incompletos, secuencias
// activas con pasos vacíos y contactos dados de baja.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown, role: "admin" as string }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ workspace: { id: "ws-1" }, supabase: state.fake, role: state.role }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { deleteBroadcast, updateBroadcastFilter } from "./broadcasts";
import { createSequence, enrollContact, updateSequence } from "./sequences";

let fake: FakeDb;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.role = "admin";
  fake.seed("broadcasts", [
    { id: "b-draft", workspace_id: "ws-1", status: "draft" },
    { id: "b-sent", workspace_id: "ws-1", status: "sending" },
    { id: "b-other", workspace_id: "ws-2", status: "draft" },
  ]);
});

describe("deleteBroadcast", () => {
  it("elimina un borrador", async () => {
    expect(await deleteBroadcast("b-draft")).toEqual({ ok: true });
    expect(fake.rows("broadcasts").map((b) => b.id)).toEqual(["b-sent", "b-other"]);
  });
  it("no elimina una difusión que ya se envió ni una de otro espacio", async () => {
    expect(await deleteBroadcast("b-sent")).toEqual({ error: "Solo se puede eliminar una difusión que todavía no se envió." });
    expect(await deleteBroadcast("b-other")).toEqual({ error: "No se encontró la difusión" });
    expect(fake.rows("broadcasts")).toHaveLength(3);
  });
  it("solo administradores", async () => {
    state.role = "member";
    expect(await deleteBroadcast("b-draft")).toHaveProperty("error");
    expect(fake.rows("broadcasts")).toHaveLength(3);
  });
});

describe("updateBroadcastFilter", () => {
  const incomplete = { combinator: "and" as const, groups: [{ combinator: "and" as const, rules: [{ field: "has_tag", operator: "equals", value: "" }] }] };
  const complete = { combinator: "and" as const, groups: [{ combinator: "and" as const, rules: [{ field: "has_tag", operator: "equals", value: "t1" }] }] };

  it("no guarda reglas incompletas", async () => {
    expect(await updateBroadcastFilter("b-draft", incomplete)).toHaveProperty("error");
    expect(fake.rows("broadcasts")[0].segment_filter).toBeUndefined();
  });
  it("guarda un filtro completo y permite quitarlo", async () => {
    expect(await updateBroadcastFilter("b-draft", complete)).toMatchObject({ ok: true });
    expect(fake.rows("broadcasts")[0].segment_filter).toEqual(complete);
    expect(await updateBroadcastFilter("b-draft", null)).toMatchObject({ ok: true, segment_filter: null });
    expect(fake.rows("broadcasts")[0].segment_filter).toBeNull();
  });
  it("no cambia una difusión ya enviada", async () => {
    expect(await updateBroadcastFilter("b-sent", complete)).toHaveProperty("error");
  });
});

describe("secuencias", () => {
  async function newSequence(steps: unknown[], status = "draft") {
    const created = await createSequence("Bienvenida");
    const id = (created as { sequence: { id: string } }).sequence.id;
    const row = fake.rows("sequences").find((s) => s.id === id)!;
    row.steps = steps;
    row.status = status;
    return id;
  }

  it("no se puede activar con un mensaje vacío, y se puede con texto", async () => {
    const id = await newSequence([]);
    const empty = await updateSequence(id, { status: "active", steps: [{ type: "message", content: "  " }] });
    expect(empty).toEqual({ error: "El paso 1 no tiene texto: escribe el mensaje." });
    expect(fake.rows("sequences")[0].status).toBe("draft");

    const ok = await updateSequence(id, { status: "active", steps: [{ type: "message", content: "Hola" }] });
    expect(ok).toMatchObject({ ok: true });
    expect(fake.rows("sequences")[0].status).toBe("active");
  });

  it("una secuencia ya activa tampoco acepta quedarse con un paso vacío", async () => {
    const id = await newSequence([{ type: "message", content: "Hola" }], "active");
    const res = await updateSequence(id, { steps: [{ type: "message", content: "" }] });
    expect(res).toHaveProperty("error");
    expect(fake.rows("sequences")[0].steps).toEqual([{ type: "message", content: "Hola" }]);
  });

  it("un borrador sí se puede guardar incompleto", async () => {
    const id = await newSequence([]);
    expect(await updateSequence(id, { steps: [{ type: "message", content: "" }] })).toMatchObject({ ok: true });
  });

  it("no inscribe a un contacto dado de baja", async () => {
    const id = await newSequence([{ type: "message", content: "Hola" }], "active");
    fake.seed("contacts", [
      { id: "c-baja", workspace_id: "ws-1", is_subscribed: false },
      { id: "c-ok", workspace_id: "ws-1", is_subscribed: true },
    ]);
    fake.seed("channels", [{ id: "ch-1", workspace_id: "ws-1" }]);
    expect(await enrollContact(id, "c-baja", "ch-1")).toEqual({
      error: "El contacto canceló su suscripción y no puede recibir la secuencia",
    });
    expect(await enrollContact(id, "c-ok", "ch-1")).toMatchObject({ ok: true });
  });
});
