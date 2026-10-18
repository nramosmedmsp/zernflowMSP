// Permisos de las acciones de gestiones, con getWorkspace y el cliente de
// servicio simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { CASE_NOT_ALLOWED, CASE_NOT_FOUND } from "@/lib/cases/access";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "" }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: "member",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

import {
  addCaseNote,
  applyBusinessTemplate,
  assignCase,
  changeCaseStage,
  closeCase,
  getContactCases,
  markNotificationsRead,
  openManualCase,
  setMyAvailability,
  takeCase,
  transferCase,
} from "./cases";

const WS = randomUUID();
const OWNER = randomUUID();
const SUP = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();
const CARLA = randomUUID(); // de otra sede
const SEDE_A = randomUUID();
const SEDE_B = randomUUID();

let fake: FakeDb;
let contactId: string;
let caseId: string;

function as(userId: string) {
  state.userId = userId;
}

function stageId(name: string): string {
  return fake.rows("case_stages").find((s) => s.name === name)!.id as string;
}

beforeEach(async () => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  fake.seed("workspaces", [{ id: WS, name: "Gimnasio", slug: "gym", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: SUP, role: "member" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
    { workspace_id: WS, user_id: CARLA, role: "member" },
  ]);
  fake.seed("teams", [
    { id: SEDE_A, workspace_id: WS, name: "Sede A", is_default: true },
    { id: SEDE_B, workspace_id: WS, name: "Sede B" },
  ]);
  fake.seed("team_members", [
    { team_id: SEDE_A, user_id: SUP, role: "supervisor" },
    { team_id: SEDE_A, user_id: ANA, role: "agent" },
    { team_id: SEDE_A, user_id: BETO, role: "agent" },
    { team_id: SEDE_B, user_id: CARLA, role: "agent" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María", team_id: SEDE_A }]);
  contactId = contact.id as string;
  const venta = fake.rows("case_types").find((t) => t.name === "Venta")!;
  const [row] = fake.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contactId,
      case_type_id: venta.id,
      stage_id: stageId("Nuevo interesado"),
      status: "open",
      team_id: SEDE_A,
      assignee_id: ANA,
      opened_at: "2026-10-18T15:00:00.000Z",
    },
  ]);
  caseId = row.id as string;
});

describe("acciones de gestiones: permisos", () => {
  it("asesor con la gestión: ve, cambia etapa y cierra", async () => {
    as(ANA);
    const view = await getContactCases(contactId);
    expect(view).toMatchObject({ ok: true });
    if (!("ok" in view)) throw new Error();
    expect(view.data.activeCaseId).toBe(caseId);
    expect(view.data.cases[0].permissions).toMatchObject({ canEdit: true, canAssign: false, canTransfer: false });
    expect(await changeCaseStage(caseId, stageId("Asesorando"))).toEqual({ ok: true });
    expect(await closeCase({ caseId, kind: "won" })).toMatchObject({ ok: true, status: "won" });
  });

  it("asesor sin relación con el contacto: no lo ve ni lo toca", async () => {
    as(BETO);
    expect(await getContactCases(contactId)).toEqual({ error: "No se encontró el contacto." });
    expect(await changeCaseStage(caseId, stageId("Asesorando"))).toEqual({ error: CASE_NOT_FOUND });
    expect(await addCaseNote(caseId, "hola")).toEqual({ error: CASE_NOT_FOUND });
  });

  it("asesor: no asigna a otros ni devuelve a la cola (salvo que la empresa lo permita)", async () => {
    as(ANA);
    expect(await assignCase(caseId, BETO)).toEqual({ error: CASE_NOT_ALLOWED });
    expect(await assignCase(caseId, null)).toEqual({ error: CASE_NOT_ALLOWED });
    fake.rows("workspaces")[0].settings = { agent_can_return_to_queue: true };
    expect(await assignCase(caseId, null)).toEqual({ ok: true });
    expect(fake.rows("cases")[0].assignee_id).toBeNull();
  });

  it("asesor: tomar de la cola solo con visibilidad 'own_and_unassigned'", async () => {
    fake.rows("cases")[0].assignee_id = null;
    fake.rows("contacts")[0].owner_id = BETO; // para que la vea
    as(BETO);
    expect(await takeCase(caseId)).toEqual({ error: CASE_NOT_ALLOWED });
    fake.rows("workspaces")[0].settings = { agent_visibility: "own_and_unassigned" };
    expect(await takeCase(caseId)).toEqual({ ok: true });
    expect(fake.rows("cases")[0].assignee_id).toBe(BETO);
  });

  it("supervisor: asigna dentro de su equipo, no fuera; no cambia de equipo", async () => {
    as(SUP);
    expect(await assignCase(caseId, BETO)).toEqual({ ok: true });
    expect(fake.rows("cases")[0].assignee_id).toBe(BETO);
    expect(await assignCase(caseId, CARLA)).toEqual({ error: "Solo puedes asignar a personas de tu equipo." });
    expect(await transferCase(caseId, SEDE_B)).toEqual({ error: CASE_NOT_ALLOWED });
    expect(await assignCase(caseId, null)).toEqual({ ok: true });
  });

  it("administrador: asigna a cualquiera y transfiere de equipo", async () => {
    as(OWNER);
    expect(await assignCase(caseId, CARLA)).toEqual({ ok: true });
    expect(await transferCase(caseId, SEDE_B, CARLA)).toEqual({ ok: true });
    expect(fake.rows("cases")[0]).toMatchObject({ team_id: SEDE_B, assignee_id: CARLA });
    expect(fake.rows("activity").some((a) => a.type === "transferred")).toBe(true);
  });

  it("valida que la etapa sea del mismo tipo y espacio", async () => {
    as(ANA);
    expect(await changeCaseStage(caseId, randomUUID())).toEqual({ error: "La etapa no pertenece a este tipo de gestión." });
    expect(await changeCaseStage(caseId, stageId("Recordatorio enviado"))).toEqual({
      error: "La etapa no pertenece a este tipo de gestión.",
    });
    expect(await changeCaseStage(caseId, stageId("Pagado"))).toEqual({
      error: "Para ganar, perder o resolver la gestión usa Cerrar.",
    });
  });

  it("no expone gestiones de otro espacio", async () => {
    const otherWs = randomUUID();
    fake.seed("workspace_members", [{ workspace_id: otherWs, user_id: OWNER, role: "owner" }]);
    as(OWNER);
    state.workspaceId = otherWs;
    expect(await changeCaseStage(caseId, stageId("Asesorando"))).toEqual({ error: CASE_NOT_FOUND });
  });

  it("plantilla de negocio: solo administradores", async () => {
    as(ANA);
    expect(await applyBusinessTemplate("gym")).toEqual({ error: ADMIN_ONLY_MESSAGE });
    as(OWNER);
    const result = await applyBusinessTemplate("gym");
    expect(result).toMatchObject({ ok: true, result: { template: "gym" } });
    expect(await applyBusinessTemplate("restaurante")).toEqual({ error: "Plantilla de negocio desconocida." });
  });

  it("abrir gestión manual: para mí sí; para otro solo supervisor o administrador", async () => {
    as(ANA);
    expect(await openManualCase({ contactId })).toMatchObject({ ok: true, status: "open" });
    expect(await openManualCase({ contactId, assignee: BETO })).toEqual({
      error: "Solo puedes asignar a personas de tu equipo.",
    });
    as(SUP);
    expect(await openManualCase({ contactId, assignee: BETO })).toMatchObject({ ok: true });
  });

  it("disponibilidad y notificaciones: cada uno las suyas", async () => {
    as(ANA);
    expect(await setMyAvailability("away")).toEqual({ ok: true, availability: "away" });
    expect(fake.rows("workspace_members").find((m) => m.user_id === ANA)!.availability).toBe("away");
    expect(await setMyAvailability("ocupada" as never)).toEqual({ error: "Datos no válidos." });

    fake.seed("notifications", [
      { workspace_id: WS, user_id: ANA, type: "mention", title: "a" },
      { workspace_id: WS, user_id: BETO, type: "mention", title: "b" },
    ]);
    expect(await markNotificationsRead("all")).toEqual({ ok: true, updated: 1 });
    expect(fake.rows("notifications").find((n) => n.user_id === BETO)!.read_at).toBeNull();
  });
});
