// Acciones de difusiones y secuencias: permisos, filtros incompletos, secuencias
// activas con pasos vacíos y contactos dados de baja.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown, role: "admin" as string }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ workspace: { id: "ws-1" }, user: { id: "u1" }, supabase: state.fake, role: state.role }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.fake }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { deleteBroadcast, updateBroadcastFilter } from "./broadcasts";
import { createSequence, deleteSequence, enrollContact, updateSequence } from "./sequences";

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

  const audits = () =>
    fake
      .rows("activity")
      .filter((a) => (a.meta as { entity?: string }).entity === "sequence")
      .map((a): Record<string, unknown> => ({ ...(a.meta as Record<string, unknown>), from: a.from_value, to: a.to_value, actor: a.actor_id }));

  it("deja registro de crear, activar, pausar, editar pasos y borrar (solo nombre y conteos, nunca el texto de un paso)", async () => {
    const id = await newSequence([]);
    await updateSequence(id, { status: "active", steps: [{ type: "message", content: "TEXTO-SECRETO-DEL-PASO" }] });
    await updateSequence(id, { steps: [{ type: "message", content: "TEXTO-SECRETO-DEL-PASO" }, { type: "delay", delayMinutes: 5 }] });
    await updateSequence(id, { status: "paused" });
    await updateSequence(id, { name: "Bienvenida 2" });
    await deleteSequence(id);
    const rows = audits();
    expect(rows.map((r) => r.action)).toEqual([
      "sequence_created",
      "sequence_activated",
      "sequence_edited", // pasos de 0 a 1 (ocurre en la misma guardada que activó)
      "sequence_edited",
      "sequence_paused",
      "sequence_edited",
      "sequence_deleted",
    ]);
    expect(rows[2]).toMatchObject({ steps_from: 0, steps_to: 1, fields: "pasos" });
    expect(rows[3]).toMatchObject({ steps_from: 1, steps_to: 2 });
    expect(rows[5]).toMatchObject({ from: "Bienvenida", to: "Bienvenida 2", fields: "nombre" });
    expect(rows.every((r) => r.actor === "u1")).toBe(true);
    expect(JSON.stringify(fake.rows("activity"))).not.toContain("TEXTO-SECRETO-DEL-PASO");
  });

  it("guardar sin cambios no deja filas de edición", async () => {
    const id = await newSequence([{ type: "message", content: "Hola" }]);
    const before = audits().length;
    await updateSequence(id, { steps: [{ type: "message", content: "Hola" }] });
    expect(audits().length).toBe(before);
  });

  it("no inscribe a un contacto dado de baja", async () => {
    const id = await newSequence([{ type: "message", content: "Hola" }], "active");
    fake.seed("contacts", [
      { id: "c-baja", workspace_id: "ws-1", is_subscribed: false, marketing_status: "opted_out" },
      { id: "c-sin", workspace_id: "ws-1", is_subscribed: true, marketing_status: "unknown" },
      { id: "c-ok", workspace_id: "ws-1", is_subscribed: true, marketing_status: "accepted" },
    ]);
    fake.seed("channels", [{ id: "ch-1", workspace_id: "ws-1" }]);
    expect(await enrollContact(id, "c-baja", "ch-1")).toEqual({
      error: "El contacto se dio de baja de la publicidad y no puede recibir la secuencia",
    });
    expect(await enrollContact(id, "c-sin", "ch-1")).toMatchObject({ error: expect.stringContaining("aún no aceptó recibir publicidad") });
    expect(await enrollContact(id, "c-ok", "ch-1")).toMatchObject({ ok: true });
  });
});
