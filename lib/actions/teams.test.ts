// Acciones de equipos: permisos de administrador y reglas de datos, con
// getWorkspace y el cliente de servicio simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";

const state = vi.hoisted(() => ({
  fake: null as unknown,
  userId: "",
  workspaceId: "",
  role: "owner" as string,
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: state.role,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  addTeamMember,
  createTeam,
  removeTeamMember,
  renameTeam,
  setDefaultTeam,
  setTeamArchived,
  setTeamAssignmentMode,
  setTeamSupervisorSkipsChats,
  updateTeamMember,
} from "./teams";

const WS = randomUUID();
const OTHER_WS = randomUUID();
const OWNER = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();
const STRANGER = randomUUID(); // no es miembro del espacio
const SEDE_A = randomUUID();
const SEDE_B = randomUUID();
const FOREIGN_TEAM = randomUUID();
const VENTAS = randomUUID();
const SOPORTE = randomUUID();
const ARCHIVADO = randomUUID();

let fake: FakeDb;

function as(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

function team(id: string) {
  return fake.rows("teams").find((t) => t.id === id)!;
}

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  as(OWNER, "owner");
  fake.seed("workspaces", [{ id: WS }, { id: OTHER_WS }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
  fake.seed("teams", [
    { id: SEDE_A, workspace_id: WS, name: "Sede A", is_default: true },
    { id: SEDE_B, workspace_id: WS, name: "Sede B" },
    { id: FOREIGN_TEAM, workspace_id: OTHER_WS, name: "Otra empresa" },
  ]);
  fake.seed("case_types", [
    { id: VENTAS, workspace_id: WS, name: "Ventas" },
    { id: SOPORTE, workspace_id: WS, name: "Soporte" },
    { id: ARCHIVADO, workspace_id: WS, name: "Viejo", archived_at: "2026-01-01T00:00:00.000Z" },
  ]);
});

describe("acciones de equipos: permisos", () => {
  it("un miembro (o supervisor de equipo) no puede tocar equipos", async () => {
    as(ANA, "member");
    const refused = { error: ADMIN_ONLY_MESSAGE };
    expect(await createTeam(WS, "Nuevo")).toEqual(refused);
    expect(await renameTeam(SEDE_A, "Otro")).toEqual(refused);
    expect(await setTeamArchived(SEDE_B, true)).toEqual(refused);
    expect(await setDefaultTeam(SEDE_B)).toEqual(refused);
    expect(await setTeamAssignmentMode(SEDE_A, "manual")).toEqual(refused);
    expect(await addTeamMember(SEDE_A, BETO, { role: "agent", caseTypeIds: null })).toEqual(refused);
    expect(await updateTeamMember(SEDE_A, BETO, { role: "agent", caseTypeIds: null })).toEqual(refused);
    expect(await removeTeamMember(SEDE_A, BETO)).toEqual(refused);
    expect(fake.rows("teams")).toHaveLength(3);
    expect(fake.rows("team_members")).toHaveLength(0);
  });

  it("un administrador sí puede", async () => {
    as(ANA, "admin");
    expect(await createTeam(WS, "Recepción")).toMatchObject({ ok: true });
  });

  it("no toca equipos de otro espacio", async () => {
    const notFound = { error: expect.stringContaining("No se encontró el equipo") };
    expect(await renameTeam(FOREIGN_TEAM, "Hackeado")).toEqual(notFound);
    expect(await setTeamArchived(FOREIGN_TEAM, true)).toEqual(notFound);
    expect(await setDefaultTeam(FOREIGN_TEAM)).toEqual(notFound);
    expect(await setTeamAssignmentMode(FOREIGN_TEAM, "manual")).toEqual(notFound);
    expect(await addTeamMember(FOREIGN_TEAM, ANA, { role: "agent", caseTypeIds: null })).toEqual(notFound);
    expect(await removeTeamMember(FOREIGN_TEAM, ANA)).toEqual(notFound);
    expect(team(FOREIGN_TEAM).name).toBe("Otra empresa");
  });

  it("rechaza crear en un espacio distinto al actual", async () => {
    expect(await createTeam(OTHER_WS, "Nuevo")).toEqual({
      error: expect.stringContaining("espacio de trabajo cambió"),
    });
  });
});

describe("acciones de equipos: equipos", () => {
  it("crea con modo por turnos, valida nombre y repetidos", async () => {
    const created = await createTeam(WS, "  Recepción   Lima ");
    expect(created).toMatchObject({ ok: true });
    const row = fake.rows("teams").find((t) => t.name === "Recepción Lima")!;
    expect(row).toMatchObject({ workspace_id: WS, assignment_mode: "round_robin", is_default: false });
    expect(await createTeam(WS, "recepción lima")).toEqual({ error: "Ya hay un equipo con ese nombre." });
    expect(await createTeam(WS, "   ")).toEqual({ error: "Escribe un nombre para el equipo." });
    expect(await createTeam(WS, "x".repeat(101))).toMatchObject({ error: expect.stringContaining("100") });
  });

  it("renombra sin chocar con otro equipo (permite conservar el propio nombre)", async () => {
    expect(await renameTeam(SEDE_B, "Sede A")).toEqual({ error: "Ya hay un equipo con ese nombre." });
    expect(await renameTeam(SEDE_B, "sede b")).toEqual({ ok: true });
    expect(team(SEDE_B).name).toBe("sede b");
  });

  it("deja un solo equipo por defecto", async () => {
    expect(await setDefaultTeam(SEDE_B)).toEqual({ ok: true });
    expect(team(SEDE_B).is_default).toBe(true);
    expect(team(SEDE_A).is_default).toBe(false);
    expect(fake.rows("teams").filter((t) => t.workspace_id === WS && t.is_default)).toHaveLength(1);
  });

  it("R2-1: con equipos activos no se puede dejar al espacio sin equipo por defecto", async () => {
    expect(await setDefaultTeam(null)).toEqual({
      error: expect.stringContaining("Tiene que haber un equipo por defecto"),
    });
    expect(team(SEDE_A).is_default).toBe(true);
  });

  it("R2-1: el equipo por defecto no se archiva mientras haya otros activos", async () => {
    expect(await setTeamArchived(SEDE_A, true)).toEqual({
      error: expect.stringContaining("Marca otro equipo como por defecto"),
    });
    expect(team(SEDE_A).is_default).toBe(true);
    expect(team(SEDE_A).archived_at ?? null).toBeNull();
    expect(await setDefaultTeam(SEDE_B)).toEqual({ ok: true });
    expect(await setTeamArchived(SEDE_A, true)).toEqual({ ok: true });
  });

  it("R2-1: el primer equipo activo del espacio queda por defecto", async () => {
    const OTHER_ONLY = randomUUID();
    state.workspaceId = OTHER_WS;
    fake.seed("workspace_members", [{ workspace_id: OTHER_WS, user_id: OWNER, role: "owner" }]);
    fake.seed("teams", [{ id: OTHER_ONLY, workspace_id: OTHER_WS, name: "Archivado", archived_at: "2026-01-01T00:00:00.000Z" }]);
    fake.rows("teams").find((t) => t.id === FOREIGN_TEAM)!.archived_at = "2026-01-01T00:00:00.000Z";
    expect(await createTeam(OTHER_WS, "Primero")).toMatchObject({ ok: true });
    expect(fake.rows("teams").find((t) => t.name === "Primero")).toMatchObject({ is_default: true });
    expect(await createTeam(OTHER_WS, "Segundo")).toMatchObject({ ok: true });
    expect(fake.rows("teams").find((t) => t.name === "Segundo")).toMatchObject({ is_default: false });
  });

  it("R2-17: el interruptor «El supervisor no recibe chats» se guarda (apagado por defecto)", async () => {
    expect(team(SEDE_A).supervisor_skips_chats ?? false).toBe(false);
    expect(await setTeamSupervisorSkipsChats(SEDE_A, true)).toEqual({ ok: true });
    expect(team(SEDE_A).supervisor_skips_chats).toBe(true);
    expect(await setTeamSupervisorSkipsChats(SEDE_A, false)).toEqual({ ok: true });
    expect(team(SEDE_A).supervisor_skips_chats).toBe(false);
    expect(await setTeamSupervisorSkipsChats(SEDE_A, "si" as never)).toMatchObject({ error: expect.any(String) });
    expect(await setTeamSupervisorSkipsChats(FOREIGN_TEAM, true)).toMatchObject({ error: expect.stringContaining("No se encontró") });
    as(ANA, "member");
    expect(await setTeamSupervisorSkipsChats(SEDE_A, true)).toEqual({ error: ADMIN_ONLY_MESSAGE });
  });

  it("archivar quita el equipo por defecto y un archivado no puede serlo", async () => {
    await setDefaultTeam(SEDE_B);
    await setTeamArchived(SEDE_B, true);
    expect(await setTeamArchived(SEDE_A, true)).toEqual({ ok: true });
    expect(team(SEDE_A)).toMatchObject({ is_default: false });
    expect(team(SEDE_A).archived_at).toEqual(expect.any(String));
    expect(await setDefaultTeam(SEDE_A)).toEqual({
      error: "Reactiva el equipo antes de marcarlo como equipo por defecto.",
    });
    expect(await setTeamArchived(SEDE_A, false)).toEqual({ ok: true });
    expect(team(SEDE_A).archived_at).toBeNull();
    expect(await setDefaultTeam(SEDE_A)).toEqual({ ok: true });
  });

  it("modo de reparto: solo valores válidos", async () => {
    expect(await setTeamAssignmentMode(SEDE_A, "least_load")).toEqual({ ok: true });
    expect(team(SEDE_A).assignment_mode).toBe("least_load");
    expect(await setTeamAssignmentMode(SEDE_A, "aleatorio" as never)).toEqual({
      error: "El modo de reparto no es válido.",
    });
    expect(team(SEDE_A).assignment_mode).toBe("least_load");
  });
});

describe("acciones de equipos: miembros", () => {
  it("agrega un miembro del espacio con rol y tipos; un extraño no", async () => {
    expect(await addTeamMember(SEDE_A, ANA, { role: "supervisor", caseTypeIds: [VENTAS] })).toEqual({ ok: true });
    expect(fake.rows("team_members")).toEqual([
      expect.objectContaining({ team_id: SEDE_A, user_id: ANA, role: "supervisor", case_type_ids: [VENTAS] }),
    ]);
    expect(await addTeamMember(SEDE_A, STRANGER, { role: "agent", caseTypeIds: null })).toEqual({
      error: "Esa persona no pertenece al espacio de trabajo.",
    });
    expect(await addTeamMember(SEDE_A, "no-es-id", { role: "agent", caseTypeIds: null })).toMatchObject({
      error: expect.any(String),
    });
  });

  it("agregar dos veces actualiza en vez de duplicar", async () => {
    await addTeamMember(SEDE_A, ANA, { role: "agent", caseTypeIds: null });
    await addTeamMember(SEDE_A, ANA, { role: "supervisor", caseTypeIds: [SOPORTE] });
    expect(fake.rows("team_members")).toHaveLength(1);
    expect(fake.rows("team_members")[0]).toMatchObject({ role: "supervisor", case_type_ids: [SOPORTE] });
  });

  it("valida los tipos de gestión: activos, no vacíos; todos = null", async () => {
    const base = { role: "agent" as const };
    expect(await addTeamMember(SEDE_A, ANA, { ...base, caseTypeIds: [ARCHIVADO] })).toMatchObject({
      error: expect.stringContaining("archivado"),
    });
    expect(await addTeamMember(SEDE_A, ANA, { ...base, caseTypeIds: [randomUUID()] })).toMatchObject({
      error: expect.stringContaining("no existe"),
    });
    expect(await addTeamMember(SEDE_A, ANA, { ...base, caseTypeIds: [] })).toMatchObject({
      error: expect.stringContaining("al menos un tipo"),
    });
    expect(await addTeamMember(SEDE_A, ANA, { role: "jefe" as never, caseTypeIds: null })).toEqual({
      error: "El rol de equipo no es válido.",
    });
    expect(fake.rows("team_members")).toHaveLength(0);
    // Marcar todos los tipos activos equivale a "todos" (null).
    expect(await addTeamMember(SEDE_A, ANA, { ...base, caseTypeIds: [VENTAS, SOPORTE] })).toEqual({ ok: true });
    expect(fake.rows("team_members")[0].case_type_ids).toBeNull();
  });

  it("actualiza y quita miembros; actualizar a quien no está falla", async () => {
    await addTeamMember(SEDE_A, ANA, { role: "agent", caseTypeIds: null });
    expect(await updateTeamMember(SEDE_A, ANA, { role: "supervisor", caseTypeIds: [VENTAS] })).toEqual({ ok: true });
    expect(fake.rows("team_members")[0]).toMatchObject({ role: "supervisor", case_type_ids: [VENTAS] });
    expect(await updateTeamMember(SEDE_A, BETO, { role: "agent", caseTypeIds: null })).toEqual({
      error: "Esa persona no está en el equipo.",
    });
    expect(await removeTeamMember(SEDE_A, ANA)).toEqual({ ok: true });
    expect(fake.rows("team_members")).toHaveLength(0);
  });
});
