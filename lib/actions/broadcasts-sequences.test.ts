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
});

describe("enrollContact (inscribir a mano)", () => {
  const step = [{ type: "message", content: "Hola" }];

  beforeEach(() => {
    fake.seed("sequences", [
      { id: "s-act", workspace_id: "ws-1", name: "Seguimiento", status: "active", steps: step },
      { id: "s-draft", workspace_id: "ws-1", name: "Borrador", status: "draft", steps: step },
      { id: "s-vacia", workspace_id: "ws-1", name: "Vacía", status: "active", steps: [] },
      { id: "s-otro", workspace_id: "ws-2", name: "Ajena", status: "active", steps: step },
    ]);
    fake.seed("contacts", [
      { id: "c-ok", workspace_id: "ws-1", is_subscribed: true, marketing_status: "accepted" },
      { id: "c-ok2", workspace_id: "ws-1", is_subscribed: true, marketing_status: "accepted" },
      { id: "c-baja", workspace_id: "ws-1", is_subscribed: false, marketing_status: "opted_out" },
      { id: "c-sin", workspace_id: "ws-1", is_subscribed: true, marketing_status: "unknown" },
      { id: "c-borrado", workspace_id: "ws-1", is_subscribed: false, marketing_status: "opted_out", erased_at: "2026-11-01T00:00:00Z" },
      { id: "c-otro", workspace_id: "ws-2", is_subscribed: true, marketing_status: "accepted" },
    ]);
    fake.seed("channels", [
      { id: "ch-1", workspace_id: "ws-1" },
      { id: "ch-2", workspace_id: "ws-1" },
      { id: "ch-x", workspace_id: "ws-2" },
    ]);
    fake.seed("contact_channels", [
      { id: "cc-1", contact_id: "c-ok", channel_id: "ch-1" },
      { id: "cc-2", contact_id: "c-ok2", channel_id: "ch-2" },
      { id: "cc-3", contact_id: "c-baja", channel_id: "ch-1" },
      { id: "cc-4", contact_id: "c-sin", channel_id: "ch-1" },
      { id: "cc-5", contact_id: "c-borrado", channel_id: "ch-1" },
    ]);
  });

  const enrollments = () => fake.rows("sequence_enrollments");
  const audits = () =>
    fake.rows("activity").filter((a) => (a.meta as { action?: string }).action === "sequence_contact_enrolled");

  it("inscribe a quien aceptó publicidad y lo anota en el registro de cambios", async () => {
    expect(await enrollContact("s-act", "c-ok", "ch-1")).toEqual({ ok: true, reactivated: false });
    expect(enrollments()).toHaveLength(1);
    expect(enrollments()[0]).toMatchObject({ sequence_id: "s-act", contact_id: "c-ok", channel_id: "ch-1", status: "active" });
    const rows = audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "config_changed", actor_id: "u1", to_value: "Seguimiento" });
    expect(rows[0].meta).toMatchObject({ entity: "sequence", name: "Seguimiento", reactivated: false });
    expect(JSON.stringify(rows[0])).not.toContain("c-ok");
  });

  it("rechaza a quien no es administrador, sin inscribir ni anotar nada", async () => {
    state.role = "member";
    expect(await enrollContact("s-act", "c-ok", "ch-1")).toHaveProperty("error");
    state.role = "agent";
    expect(await enrollContact("s-act", "c-ok", "ch-1")).toHaveProperty("error");
    expect(enrollments()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("rechaza una secuencia inactiva, sin pasos o de otro espacio", async () => {
    expect(await enrollContact("s-draft", "c-ok", "ch-1")).toEqual({ error: "La secuencia no está activa" });
    expect(await enrollContact("s-vacia", "c-ok", "ch-1")).toEqual({ error: "La secuencia no tiene pasos" });
    expect(await enrollContact("s-otro", "c-ok", "ch-1")).toEqual({ error: "No se encontró la secuencia" });
    expect(enrollments()).toHaveLength(0);
  });

  it("rechaza al que no aceptó publicidad (sin registrar o de baja)", async () => {
    expect(await enrollContact("s-act", "c-sin", "ch-1")).toMatchObject({ error: expect.stringContaining("aún no aceptó recibir publicidad") });
    expect(await enrollContact("s-act", "c-baja", "ch-1")).toMatchObject({ error: expect.stringContaining("se dio de baja de la publicidad") });
    expect(enrollments()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("a un cliente eliminado le dice que sus datos se eliminaron, no que se dio de baja", async () => {
    const res = await enrollContact("s-act", "c-borrado", "ch-1");
    expect(res).toMatchObject({ error: expect.stringContaining("se eliminaron") });
    expect((res as { error: string }).error).not.toContain("baja");
    expect(enrollments()).toHaveLength(0);
  });

  it("rechaza un contacto de otro espacio", async () => {
    expect(await enrollContact("s-act", "c-otro", "ch-1")).toEqual({ error: "No se encontró el contacto" });
  });

  it("rechaza un canal ajeno: de otro espacio o de otro contacto", async () => {
    expect(await enrollContact("s-act", "c-ok", "ch-x")).toEqual({ error: "No se encontró el canal" });
    expect(await enrollContact("s-act", "c-ok", "ch-2")).toEqual({ error: "Ese canal no pertenece a este contacto." });
    expect(await enrollContact("s-act", "c-ok", "no-existe")).toEqual({ error: "No se encontró el canal" });
    expect(enrollments()).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  it("si ya está inscrito responde «ya está inscrito» y no anota otra vez", async () => {
    await enrollContact("s-act", "c-ok", "ch-1");
    expect(await enrollContact("s-act", "c-ok", "ch-1")).toEqual({ error: "El contacto ya está inscrito en esta secuencia" });
    expect(enrollments()).toHaveLength(1);
    expect(audits()).toHaveLength(1);
  });

  it("tras cancelar o terminar, reactiva la misma fila", async () => {
    await enrollContact("s-act", "c-ok", "ch-1");
    const id = enrollments()[0].id;
    enrollments()[0].status = "cancelled";
    expect(await enrollContact("s-act", "c-ok", "ch-1")).toEqual({ ok: true, reactivated: true });
    expect(enrollments()).toHaveLength(1);
    expect(enrollments()[0]).toMatchObject({ id, status: "active", current_step_index: 0 });
    expect(audits().map((a) => (a.meta as { reactivated: boolean }).reactivated)).toEqual([false, true]);
  });
});
