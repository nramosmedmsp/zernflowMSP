// Registro de cambios de configuración (horario, feriados, atención, respuestas compartidas y diccionario):
// cada cambio confirmado deja una fila `config_changed` con antes → después, y lo que no cambió o se
// rechazó no deja nada. Nunca se guarda el texto de una respuesta.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, role: "admin" as string }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    viewAs: { locked: false, active: false, ended: false, info: null },
    user: { id: "u1" },
    workspace: { id: "ws-1", name: "Tienda" },
    role: state.role,
    supabase: state.db,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.db,
  createClient: async () => state.db,
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getWorkspaceSecretsStatus: async () => ({ hasLateApiKey: false, hasAiApiKey: false }),
  saveWorkspaceSecrets: async () => ({ error: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/flow-lab/scenarios/server", () => ({ readMemberNames: async () => ({}) }));

import { addHoliday, loadPeruHolidays, removeHoliday, saveCompanyHours, saveTeamHours } from "./hours";
import { saveAttentionAutomation, saveAttentionSettings } from "./settings";
import { createSavedReply, deleteSavedReply, updateSavedReply } from "./saved-replies";
import { addOrRequestSpellWord, approveSpellWord, rejectSpellWord, removeSpellWord } from "./spell-words";

let fake: FakeDb;
const TEAM = randomUUID();
const audits = (entity?: string) =>
  fake
    .rows("activity")
    .filter((a) => (a.meta as { entity?: string }).entity && (!entity || (a.meta as { entity?: string }).entity === entity))
    .map((a): Record<string, unknown> => ({ ...(a.meta as Record<string, unknown>), from: a.from_value, to: a.to_value, actor: a.actor_id }));

beforeEach(() => {
  fake = new FakeDb();
  state.db = fake;
  state.role = "admin";
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.seed("workspaces", [{ id: "ws-1", name: "Tienda", settings: {} }]);
  fake.seed("teams", [{ id: TEAM, workspace_id: "ws-1", name: "Ventas", business_hours: null }]);
});

describe("horario y feriados", () => {
  it("cambiar el horario de la empresa anota los días que cambiaron y devolverlo deja otra fila", async () => {
    expect(await saveCompanyHours("ws-1", { mon: [["09:00", "21:00"]] })).toEqual({ ok: true });
    expect(await saveCompanyHours("ws-1", { mon: [["09:00", "21:00"]] })).toEqual({ ok: true }); // igual: sin fila
    expect(await saveCompanyHours("ws-1", { mon: [["09:00", "20:00"]] })).toEqual({ ok: true });
    const rows = audits("hours");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "hours_changed", scope: "company", day_mon_from: "24 horas", day_mon_to: "09:00-21:00", actor: "u1" });
    expect(rows[1]).toMatchObject({ day_mon_from: "09:00-21:00", day_mon_to: "09:00-20:00" });
  });

  it("el horario de un equipo anota el nombre del equipo", async () => {
    expect(await saveTeamHours(TEAM, { tue: [["10:00", "14:00"]] })).toEqual({ ok: true });
    expect(audits("hours")[0]).toMatchObject({ action: "hours_changed", scope: "team", team_name: "Ventas", day_tue_to: "10:00-14:00", uses_company_hours: false });
  });

  it("añadir y quitar un feriado dejan nombre y fecha (el nombre se lee antes de borrar)", async () => {
    expect(await addHoliday({ teamId: null, date: "2026-12-01", name: "Aniversario" })).toEqual({ ok: true });
    const id = fake.rows("holidays")[0].id as string;
    expect(await removeHoliday(id)).toEqual({ ok: true });
    expect(audits("hours")).toEqual([
      expect.objectContaining({ action: "holiday_added", name: "Aniversario", date: "2026-12-01", actor: "u1" }),
      expect.objectContaining({ action: "holiday_removed", name: "Aniversario", date: "2026-12-01" }),
    ]);
  });

  it("cargar los feriados de Perú deja el año y cuántos se agregaron", async () => {
    const res = await loadPeruHolidays({ teamId: TEAM, year: 2027 });
    expect(res).toMatchObject({ ok: true });
    expect(audits("hours")[0]).toMatchObject({ action: "holidays_loaded", year: 2027, team_name: "Ventas", added: (res as { added: number }).added });
  });

  it("un miembro no cambia nada y no deja fila", async () => {
    state.role = "member";
    await saveCompanyHours("ws-1", { mon: [["09:00", "21:00"]] });
    await addHoliday({ teamId: null, date: "2026-12-01", name: "X" });
    expect(audits()).toEqual([]);
  });
});

describe("ajustes de atención", () => {
  it("anota solo lo que cambió y, de la respuesta fuera de horario, nunca el texto", async () => {
    fake.rows("workspaces")[0].settings = { agent_visibility: "own", assignment_mode: "round_robin" };
    await saveAttentionSettings("ws-1", { agentVisibility: "team", assignmentMode: "round_robin", agentCanReturnToQueue: false, staleStageDays: 7 });
    await saveAttentionAutomation("ws-1", { offHoursEnabled: true, offHoursText: "TEXTO-SECRETO de la respuesta", minHoursBetween: "", reassignMinutes: "30" });
    const rows = audits("attention");
    expect(rows[0]).toMatchObject({ action: "attention_settings_changed", visibility_from: "own", visibility_to: "team" });
    expect(rows[0]).not.toHaveProperty("assignment_from");
    expect(rows[1]).toMatchObject({ action: "attention_automation_changed", off_hours_enabled_from: false, off_hours_enabled_to: true, off_hours_text_changed: true, reassign_minutes_from: null, reassign_minutes_to: 30 });
    expect(JSON.stringify(fake.rows("activity"))).not.toContain("TEXTO-SECRETO");
  });

  it("guardar lo mismo no deja fila", async () => {
    await saveAttentionSettings("ws-1", { agentVisibility: "own", assignmentMode: "round_robin", agentCanReturnToQueue: false, staleStageDays: 7 });
    expect(audits("attention")).toEqual([]);
  });
});

describe("respuestas guardadas compartidas", () => {
  it("crear, editar y borrar una de la empresa dejan filas con el título, nunca el texto", async () => {
    const created = await createSavedReply({ scope: "workspace", title: "Saludo", shortcut: null, body: "Hola, TEXTO-SECRETO", caseTypeId: null });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { reply: { id: string } }).reply.id;
    await updateSavedReply(id, { title: "Saludo nuevo", shortcut: null, body: "Otro TEXTO-SECRETO", caseTypeId: null });
    await deleteSavedReply(id);
    const rows = audits("saved_reply");
    expect(rows.map((r) => r.action)).toEqual(["saved_reply_created", "saved_reply_updated", "saved_reply_deleted"]);
    expect(rows[1]).toMatchObject({ name: "Saludo nuevo", scope: "workspace", from: "Saludo", to: "Saludo nuevo", fields: "título, texto" });
    expect(JSON.stringify(fake.rows("activity"))).not.toContain("TEXTO-SECRETO");
  });

  it("las de un equipo anotan el equipo; las personales no se registran", async () => {
    await createSavedReply({ scope: "team", teamId: TEAM, title: "Garantía", shortcut: null, body: "Texto", caseTypeId: null });
    await createSavedReply({ scope: "personal", title: "Mi nota", shortcut: null, body: "Texto", caseTypeId: null });
    const rows = audits("saved_reply");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "saved_reply_created", scope: "team", team_name: "Ventas", name: "Garantía" });
  });
});

describe("diccionario de la tienda", () => {
  it("agregar, aprobar, rechazar y quitar dejan la palabra", async () => {
    await addOrRequestSpellWord("creatina");
    fake.seed("spell_words", [
      { id: "p1", workspace_id: "ws-1", word: "whey", normalized: "whey", status: "pending", added_by: "u2" },
      { id: "p2", workspace_id: "ws-1", word: "xyz", normalized: "xyz", status: "pending", added_by: "u2" },
    ]);
    await approveSpellWord("p1");
    await rejectSpellWord("p2");
    const added = fake.rows("spell_words").find((w) => w.word === "creatina")!.id as string;
    await removeSpellWord(added);
    expect(audits("dictionary").map((r) => [r.action, r.word])).toEqual([
      ["spell_word_added", "creatina"],
      ["spell_word_approved", "whey"],
      ["spell_word_rejected", "xyz"], // rechazar no deja además una fila de «quitada»
      ["spell_word_removed", "creatina"],
    ]);
  });
});
