import { describe, it, expect } from "vitest";
import {
  agentVisibilityFromSettings,
  canManageSecrets,
  canSeeContactRules,
  contactVisibilityReason,
  isActiveCaseStatus,
  isAdminRole,
  isOwnerRole,
  isWorkspaceRole,
  normalizeAgentVisibility,
  type CaseVisibilityInfo,
  type ContactVisibilityInput,
  type TeamMembershipInfo,
} from "./permissions";
import type { AgentVisibility } from "@/lib/types/database";

describe("roles", () => {
  it("isAdminRole: dueño y administrador sí; miembro, vacío o desconocido no", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("Owner")).toBe(false);
  });

  it("isOwnerRole y canManageSecrets: solo el dueño", () => {
    expect(isOwnerRole("owner")).toBe(true);
    expect(isOwnerRole("admin")).toBe(false);
    expect(canManageSecrets("owner")).toBe(true);
    expect(canManageSecrets("admin")).toBe(false);
    expect(canManageSecrets("member")).toBe(false);
  });

  it("isWorkspaceRole valida los tres roles", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(true);
    expect(isWorkspaceRole("member")).toBe(true);
    expect(isWorkspaceRole("viewer")).toBe(false);
    expect(isWorkspaceRole(1)).toBe(false);
  });

  it("isActiveCaseStatus: programada y abierta", () => {
    expect(isActiveCaseStatus("scheduled")).toBe(true);
    expect(isActiveCaseStatus("open")).toBe(true);
    for (const s of ["won", "lost", "resolved", "cancelled", null, undefined]) {
      expect(isActiveCaseStatus(s)).toBe(false);
    }
  });
});

describe("visibilidad de asesores", () => {
  it("normaliza valores desconocidos a 'own'", () => {
    expect(normalizeAgentVisibility("team")).toBe("team");
    expect(normalizeAgentVisibility("own_and_unassigned")).toBe("own_and_unassigned");
    expect(normalizeAgentVisibility("todos")).toBe("own");
    expect(normalizeAgentVisibility(undefined)).toBe("own");
  });

  it("lee settings.agent_visibility con valores por defecto", () => {
    expect(agentVisibilityFromSettings({ agent_visibility: "team" })).toBe("team");
    expect(agentVisibilityFromSettings({})).toBe("own");
    expect(agentVisibilityFromSettings(null)).toBe("own");
    expect(agentVisibilityFromSettings([])).toBe("own");
    expect(agentVisibilityFromSettings("team")).toBe("own");
  });
});

// Mismo escenario que supabase/tests/fase1_rls_check.sql.
const OWNER = "u-owner";
const ADMIN = "u-admin";
const SUP_A = "u-sup-a";
const AG_A = "u-ag-a";
const AG_B = "u-ag-b";
const TEAM_A = "team-a";
const TEAM_B = "team-b";

const ROLES: Record<string, string> = {
  [OWNER]: "owner",
  [ADMIN]: "admin",
  [SUP_A]: "member",
  [AG_A]: "member",
  [AG_B]: "member",
};

const MEMBERSHIPS: Record<string, TeamMembershipInfo[]> = {
  [OWNER]: [],
  [ADMIN]: [],
  [SUP_A]: [{ teamId: TEAM_A, role: "supervisor" }],
  [AG_A]: [{ teamId: TEAM_A, role: "agent" }],
  [AG_B]: [{ teamId: TEAM_B, role: "agent" }],
};

interface FixtureContact {
  ownerId: string | null;
  teamId: string | null;
  cases: CaseVisibilityInfo[];
}

const CONTACTS: Record<string, FixtureContact> = {
  A1: { teamId: TEAM_A, ownerId: null, cases: [{ status: "open", teamId: TEAM_A, assigneeId: AG_A }] },
  A2: { teamId: TEAM_A, ownerId: null, cases: [{ status: "open", teamId: TEAM_A, assigneeId: null }] },
  A3: { teamId: TEAM_A, ownerId: null, cases: [] },
  B1: { teamId: TEAM_B, ownerId: null, cases: [{ status: "open", teamId: TEAM_B, assigneeId: AG_B }] },
  B2: { teamId: TEAM_B, ownerId: AG_A, cases: [] },
  B3: { teamId: TEAM_B, ownerId: null, cases: [{ status: "won", teamId: TEAM_B, assigneeId: AG_A }] },
  B4: { teamId: TEAM_B, ownerId: null, cases: [{ status: "scheduled", teamId: TEAM_B, assigneeId: AG_A }] },
  F1: { teamId: TEAM_B, ownerId: null, cases: [{ status: "open", teamId: TEAM_A, assigneeId: null }] },
  N1: { teamId: null, ownerId: null, cases: [{ status: "open", teamId: null, assigneeId: null }] },
};

function visibleContacts(userId: string, visibility: AgentVisibility): string {
  return Object.entries(CONTACTS)
    .filter(([, c]) =>
      canSeeContactRules({
        userId,
        role: ROLES[userId],
        agentVisibility: visibility,
        workspaceHasTeams: true,
        memberships: MEMBERSHIPS[userId],
        contact: { ownerId: c.ownerId, teamId: c.teamId },
        cases: c.cases,
      }),
    )
    .map(([label]) => label)
    .sort()
    .join(",");
}

const ALL = "A1,A2,A3,B1,B2,B3,B4,F1,N1";

describe("canSeeContactRules: espacio con equipos (escenario de la prueba SQL)", () => {
  const expected: Array<[string, string, AgentVisibility | "*", string]> = [
    ["Dueño", OWNER, "*", ALL],
    ["Administrador", ADMIN, "*", ALL],
    ["supA", SUP_A, "*", "A1,A2,A3,F1"],
    ["agA", AG_A, "own", "A1,B2,B4"],
    ["agA", AG_A, "own_and_unassigned", "A1,A2,B2,B4,F1"],
    ["agA", AG_A, "team", "A1,A2,A3,B2,B4,F1"],
    ["agB", AG_B, "own", "B1"],
    ["agB", AG_B, "own_and_unassigned", "B1"],
    ["agB", AG_B, "team", "B1,B2,B3,B4,F1"],
  ];

  for (const [persona, userId, mode, contacts] of expected) {
    const modes: AgentVisibility[] = mode === "*" ? ["own", "own_and_unassigned", "team"] : [mode];
    for (const m of modes) {
      it(`${persona} en modo ${m} ve ${contacts}`, () => {
        expect(visibleContacts(userId, m)).toBe(contacts);
      });
    }
  }
});

describe("canSeeContactRules: espacio sin equipos", () => {
  const base = (cases: CaseVisibilityInfo[], visibility: AgentVisibility): ContactVisibilityInput => ({
    userId: AG_A,
    role: "member",
    agentVisibility: visibility,
    workspaceHasTeams: false,
    memberships: [],
    contact: { ownerId: null, teamId: null },
    cases,
  });
  const X1: CaseVisibilityInfo[] = [{ status: "open", teamId: null, assigneeId: AG_A }];
  const X2: CaseVisibilityInfo[] = [{ status: "open", teamId: null, assigneeId: null }];
  const X3: CaseVisibilityInfo[] = [];

  it("own: solo las asignadas", () => {
    expect(canSeeContactRules(base(X1, "own"))).toBe(true);
    expect(canSeeContactRules(base(X2, "own"))).toBe(false);
    expect(canSeeContactRules(base(X3, "own"))).toBe(false);
  });

  it("own_and_unassigned: además cualquier gestión abierta sin asignar", () => {
    expect(contactVisibilityReason(base(X2, "own_and_unassigned"))).toBe("unassigned_queue");
    expect(canSeeContactRules(base(X3, "own_and_unassigned"))).toBe(false);
  });

  it("team: todo el espacio (como antes de la fase 1)", () => {
    expect(contactVisibilityReason(base(X3, "team"))).toBe("team");
  });
});

describe("contactVisibilityReason: detalles", () => {
  const input = (over: Partial<ContactVisibilityInput>): ContactVisibilityInput => ({
    userId: AG_A,
    role: "member",
    agentVisibility: "own",
    workspaceHasTeams: true,
    memberships: [{ teamId: TEAM_A, role: "agent" }],
    contact: { ownerId: null, teamId: TEAM_A },
    cases: [],
    ...over,
  });

  it("quien no es miembro del espacio no ve nada, aunque sea responsable", () => {
    expect(contactVisibilityReason(input({ role: null, contact: { ownerId: AG_A, teamId: null } }))).toBeNull();
  });

  it("da la primera regla que se cumple", () => {
    expect(contactVisibilityReason(input({ role: "admin" }))).toBe("admin");
    expect(
      contactVisibilityReason(
        input({
          contact: { ownerId: AG_A, teamId: TEAM_A },
          cases: [{ status: "open", teamId: TEAM_A, assigneeId: AG_A }],
        }),
      ),
    ).toBe("assigned");
    expect(contactVisibilityReason(input({ contact: { ownerId: AG_A, teamId: TEAM_A } }))).toBe("owner");
  });

  it("una gestión cerrada asignada no da visibilidad", () => {
    for (const status of ["won", "lost", "resolved", "cancelled"] as const) {
      expect(
        canSeeContactRules(input({ cases: [{ status, teamId: TEAM_A, assigneeId: AG_A }] })),
      ).toBe(false);
    }
  });

  it("el supervisor ve las gestiones no cerradas enviadas a su equipo aunque el contacto sea de otro", () => {
    const sup = input({
      userId: SUP_A,
      memberships: [{ teamId: TEAM_A, role: "supervisor" }],
      contact: { ownerId: null, teamId: TEAM_B },
    });
    expect(
      contactVisibilityReason({ ...sup, cases: [{ status: "open", teamId: TEAM_A, assigneeId: AG_B }] }),
    ).toBe("supervisor");
    expect(
      contactVisibilityReason({ ...sup, cases: [{ status: "won", teamId: TEAM_A, assigneeId: AG_B }] }),
    ).toBeNull();
  });

  it("un equipo archivado no da visibilidad", () => {
    expect(
      canSeeContactRules(
        input({
          agentVisibility: "team",
          memberships: [{ teamId: TEAM_A, role: "supervisor", archived: true }],
        }),
      ),
    ).toBe(false);
  });

  it("own_and_unassigned con equipos: la gestión sin equipo no cuenta", () => {
    expect(
      canSeeContactRules(
        input({
          agentVisibility: "own_and_unassigned",
          contact: { ownerId: null, teamId: null },
          cases: [{ status: "open", teamId: null, assigneeId: null }],
        }),
      ),
    ).toBe(false);
  });

  it("own_and_unassigned: una gestión programada sin asignar no cuenta (solo abiertas)", () => {
    expect(
      canSeeContactRules(
        input({
          agentVisibility: "own_and_unassigned",
          cases: [{ status: "scheduled", teamId: TEAM_A, assigneeId: null }],
        }),
      ),
    ).toBe(false);
  });

  it("una visibilidad desconocida se trata como 'own'", () => {
    expect(canSeeContactRules(input({ agentVisibility: "todos" }))).toBe(false);
  });
});
