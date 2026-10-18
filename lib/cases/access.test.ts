import { describe, expect, it } from "vitest";
import { canAssignTo, casePermissions, type ActorInfo, type CaseAccessInfo } from "./access";

function actor(extra: Partial<ActorInfo> = {}): ActorInfo {
  return {
    userId: "me",
    role: "member",
    memberships: [],
    agentVisibility: "own",
    agentCanReturnToQueue: false,
    workspaceHasTeams: true,
    ...extra,
  };
}

function info(extra: Partial<CaseAccessInfo> = {}): CaseAccessInfo {
  return {
    status: "open",
    assigneeId: "otro",
    teamId: "sede-a",
    contactTeamId: "sede-a",
    canSeeContact: true,
    ...extra,
  };
}

const target = (userId: string, teamIds: string[] = [], isWorkspaceMember = true) => ({
  userId,
  teamIds,
  isWorkspaceMember,
});

describe("permisos sobre una gestión", () => {
  it("sin visibilidad del contacto: nada", () => {
    const p = casePermissions(actor({ role: "owner" }), info({ canSeeContact: false }));
    expect(Object.values(p).every((v) => v === false)).toBe(true);
  });

  it("administrador: todo, incluido transferir de equipo", () => {
    const p = casePermissions(actor({ role: "admin" }), info());
    expect(p).toMatchObject({
      canView: true,
      canEdit: true,
      canClose: true,
      canNote: true,
      canAssign: true,
      canReturnToQueue: true,
      canTake: true,
      canTransfer: true,
    });
  });

  it("supervisor del equipo: edita, asigna y devuelve a la cola, pero no cambia de equipo", () => {
    const p = casePermissions(actor({ memberships: [{ teamId: "sede-a", role: "supervisor" }] }), info());
    expect(p).toMatchObject({ canEdit: true, canClose: true, canAssign: true, canReturnToQueue: true, canTransfer: false });
  });

  it("supervisor del equipo del contacto (gestión en un equipo fijo) también edita", () => {
    const p = casePermissions(
      actor({ memberships: [{ teamId: "sede-a", role: "supervisor" }] }),
      info({ teamId: "central", contactTeamId: "sede-a" }),
    );
    expect(p.canEdit).toBe(true);
  });

  it("asesor con su gestión: edita y cierra; no asigna a otros", () => {
    const p = casePermissions(actor({ memberships: [{ teamId: "sede-a", role: "agent" }] }), info({ assigneeId: "me" }));
    expect(p).toMatchObject({ canEdit: true, canClose: true, canNote: true, canAssign: false, canTransfer: false });
  });

  it("asesor: devolver a la cola solo si la empresa lo permite", () => {
    const mine = info({ assigneeId: "me" });
    expect(casePermissions(actor(), mine).canReturnToQueue).toBe(false);
    expect(casePermissions(actor({ agentCanReturnToQueue: true }), mine).canReturnToQueue).toBe(true);
    // Nunca la de otro.
    expect(casePermissions(actor({ agentCanReturnToQueue: true }), info()).canReturnToQueue).toBe(false);
  });

  it("asesor que ve la gestión de otro (visibilidad 'team'): solo notas", () => {
    const p = casePermissions(actor({ agentVisibility: "team", memberships: [{ teamId: "sede-a", role: "agent" }] }), info());
    expect(p).toMatchObject({ canView: true, canNote: true, canEdit: false, canClose: false, canTake: false });
  });

  it("tomar una sin asignar: no con 'own'; sí con 'own_and_unassigned' de su equipo", () => {
    const unassigned = info({ assigneeId: null });
    const agent = { memberships: [{ teamId: "sede-a", role: "agent" as const }] };
    expect(casePermissions(actor(agent), unassigned).canTake).toBe(false);
    expect(casePermissions(actor({ ...agent, agentVisibility: "own_and_unassigned" }), unassigned).canTake).toBe(true);
    expect(
      casePermissions(actor({ ...agent, agentVisibility: "own_and_unassigned" }), info({ assigneeId: null, teamId: "sede-b" }))
        .canTake,
    ).toBe(false);
    // Sin equipos en el espacio, cualquiera de la empresa.
    expect(
      casePermissions(actor({ agentVisibility: "own_and_unassigned", workspaceHasTeams: false }), info({ assigneeId: null, teamId: null }))
        .canTake,
    ).toBe(true);
  });

  it("gestión cerrada: solo ver y anotar", () => {
    const p = casePermissions(actor({ role: "owner" }), info({ status: "won" }));
    expect(p).toMatchObject({ canView: true, canNote: true, canEdit: false, canClose: false, canAssign: false });
  });

  it("programada: se edita pero no se cierra", () => {
    const p = casePermissions(actor(), info({ status: "scheduled", assigneeId: "me" }));
    expect(p).toMatchObject({ canEdit: true, canClose: false });
  });
});

describe("a quién se puede asignar", () => {
  const supervisor = actor({ memberships: [{ teamId: "sede-a", role: "supervisor" }] });

  it("administrador: a cualquier miembro del espacio", () => {
    expect(canAssignTo(actor({ role: "owner" }), info(), target("x"))).toBe(true);
    expect(canAssignTo(actor({ role: "owner" }), info(), target("x", [], false))).toBe(false);
  });

  it("supervisor: solo a personas de su equipo", () => {
    expect(canAssignTo(supervisor, info(), target("x", ["sede-a"]))).toBe(true);
    expect(canAssignTo(supervisor, info(), target("x", ["sede-b"]))).toBe(false);
  });

  it("supervisor: no en gestiones de otro equipo", () => {
    expect(canAssignTo(supervisor, info({ teamId: "sede-b", contactTeamId: "sede-b" }), target("x", ["sede-b"]))).toBe(false);
  });

  it("asesor: no asigna a otros; a sí mismo solo si puede tomarla", () => {
    const agent = actor({ memberships: [{ teamId: "sede-a", role: "agent" }] });
    expect(canAssignTo(agent, info({ assigneeId: null }), target("x", ["sede-a"]))).toBe(false);
    expect(canAssignTo(agent, info({ assigneeId: null }), target("me", ["sede-a"]))).toBe(false);
    const queue = actor({ memberships: [{ teamId: "sede-a", role: "agent" }], agentVisibility: "own_and_unassigned" });
    expect(canAssignTo(queue, info({ assigneeId: null }), target("me", ["sede-a"]))).toBe(true);
  });
});
