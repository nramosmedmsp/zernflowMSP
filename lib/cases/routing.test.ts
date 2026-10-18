import { describe, expect, it } from "vitest";
import {
  assignmentModeFromSettings,
  decideAssignment,
  eligibleMembers,
  pickAssignee,
  resolveTargetTeamId,
  type PickCandidate,
  type RoutingInput,
  type RoutingMember,
} from "./routing";

const VENTA = "type-venta";
const POSTVENTA = "type-postventa";

function member(userId: string, extra: Partial<RoutingMember> = {}): RoutingMember {
  return { userId, role: "member", availability: "available", lastAssignedAt: null, ...extra };
}

function input(extra: Partial<RoutingInput> = {}): RoutingInput {
  return {
    caseTypeId: VENTA,
    routing: "contact_owner",
    fixedTeamId: null,
    currentTeamId: null,
    contactOwnerId: null,
    contactTeamId: null,
    teams: [],
    teamMembers: [],
    members: [member("ana"), member("beto"), member("carla"), member("admin", { role: "admin" })],
    workspaceMode: "round_robin",
    ...extra,
  };
}

const withTeams = (extra: Partial<RoutingInput> = {}) =>
  input({
    teams: [
      { id: "sede-a", isDefault: true, assignmentMode: "round_robin" },
      { id: "sede-b", isDefault: false, assignmentMode: "least_load" },
      { id: "central", isDefault: false, assignmentMode: "manual" },
    ],
    teamMembers: [
      { teamId: "sede-a", userId: "ana", role: "agent", caseTypeIds: null },
      { teamId: "sede-a", userId: "beto", role: "agent", caseTypeIds: [POSTVENTA] },
      { teamId: "sede-a", userId: "sup", role: "supervisor", caseTypeIds: null },
      { teamId: "sede-b", userId: "carla", role: "agent", caseTypeIds: null },
      { teamId: "central", userId: "beto", role: "agent", caseTypeIds: null },
    ],
    members: [member("ana"), member("beto"), member("carla"), member("sup"), member("admin", { role: "admin" })],
    ...extra,
  });

describe("equipo de destino", () => {
  it("sin equipos no hay equipo", () => {
    expect(resolveTargetTeamId(input({ contactTeamId: "x" }))).toBeNull();
  });

  it("contact_owner y contact_team usan el equipo del contacto, o el por defecto", () => {
    expect(resolveTargetTeamId(withTeams({ contactTeamId: "sede-b" }))).toBe("sede-b");
    expect(resolveTargetTeamId(withTeams({ routing: "contact_team", contactTeamId: "sede-b" }))).toBe("sede-b");
    expect(resolveTargetTeamId(withTeams())).toBe("sede-a");
  });

  it("fixed_team usa el equipo fijo; si está archivado vuelve al del contacto", () => {
    expect(resolveTargetTeamId(withTeams({ routing: "fixed_team", fixedTeamId: "central", contactTeamId: "sede-b" }))).toBe(
      "central",
    );
    expect(resolveTargetTeamId(withTeams({ routing: "fixed_team", fixedTeamId: "borrado", contactTeamId: "sede-b" }))).toBe(
      "sede-b",
    );
  });

  it("respeta el equipo ya guardado en la gestión (transferencias)", () => {
    expect(resolveTargetTeamId(withTeams({ currentTeamId: "sede-b", contactTeamId: "sede-a" }))).toBe("sede-b");
  });

  it("con equipos pero sin destino ni equipo por defecto: ninguno", () => {
    const teams = withTeams().teams.map((t) => ({ ...t, isDefault: false }));
    expect(resolveTargetTeamId(withTeams({ teams }))).toBeNull();
  });
});

describe("elegibles", () => {
  it("sin equipos: los miembros con rol 'member' (no administradores)", () => {
    expect(eligibleMembers(input(), null).map((m) => m.userId)).toEqual(["ana", "beto", "carla"]);
  });

  it("con equipo: sus miembros que atienden el tipo (null = todos)", () => {
    expect(eligibleMembers(withTeams(), "sede-a").map((m) => m.userId)).toEqual(["ana", "sup"]);
    expect(eligibleMembers(withTeams({ caseTypeId: POSTVENTA }), "sede-a").map((m) => m.userId)).toEqual([
      "ana",
      "beto",
      "sup",
    ]);
  });

  it("una gestión sin clasificar la puede recibir cualquiera del equipo", () => {
    expect(eligibleMembers(withTeams({ caseTypeId: null }), "sede-a").map((m) => m.userId)).toEqual([
      "ana",
      "beto",
      "sup",
    ]);
  });

  it("ignora a quien ya no es miembro del espacio", () => {
    const members = withTeams().members.filter((m) => m.userId !== "ana");
    expect(eligibleMembers(withTeams({ members }), "sede-a").map((m) => m.userId)).toEqual(["sup"]);
  });

  it("con equipos y sin destino: nadie", () => {
    expect(eligibleMembers(withTeams(), null)).toEqual([]);
  });
});

describe("decideAssignment", () => {
  it("responsable fijo disponible: va a él", () => {
    expect(decideAssignment(input({ contactOwnerId: "beto" }))).toEqual({ kind: "owner", teamId: null, userId: "beto" });
  });

  it("responsable fijo ausente: va a otra persona disponible (el responsable no cambia)", () => {
    const members = input().members.map((m) => (m.userId === "beto" ? { ...m, availability: "away" as const } : m));
    const decision = decideAssignment(input({ contactOwnerId: "beto", members }));
    expect(decision.kind).toBe("pick");
    if (decision.kind === "pick") expect(decision.candidates).not.toContain("beto");
  });

  it("responsable fijo que no atiende el tipo en su equipo: se reparte", () => {
    const decision = decideAssignment(withTeams({ contactOwnerId: "beto", contactTeamId: "sede-a" }));
    expect(decision).toMatchObject({ kind: "pick", teamId: "sede-a", candidates: ["ana", "sup"] });
  });

  it("el responsable fijo solo aplica con destino 'al responsable del contacto'", () => {
    const decision = decideAssignment(input({ routing: "contact_team", contactOwnerId: "beto" }));
    expect(decision.kind).toBe("pick");
  });

  it("responsable fijo incluso en modo manual", () => {
    expect(decideAssignment(withTeams({ contactOwnerId: "beto", contactTeamId: "central" }))).toEqual({
      kind: "owner",
      teamId: "central",
      userId: "beto",
    });
  });

  it("modo manual: no asigna", () => {
    expect(decideAssignment(withTeams({ contactTeamId: "central" }))).toEqual({ kind: "manual", teamId: "central" });
    expect(decideAssignment(input({ workspaceMode: "manual" }))).toEqual({ kind: "manual", teamId: null });
  });

  it("modo del equipo: least_load en sede-b", () => {
    expect(decideAssignment(withTeams({ contactTeamId: "sede-b" }))).toMatchObject({
      kind: "pick",
      mode: "least_load",
      teamId: "sede-b",
      candidates: ["carla"],
    });
  });

  it("sin elegibles disponibles: none", () => {
    const members = input().members.map((m) => ({ ...m, availability: "away" as const }));
    expect(decideAssignment(input({ members }))).toEqual({ kind: "none", teamId: null });
    expect(decideAssignment(withTeams({ teams: withTeams().teams.map((t) => ({ ...t, isDefault: false })) }))).toEqual({
      kind: "none",
      teamId: null,
    });
  });

  it("ordena los candidatos por turnos", () => {
    const members = [
      member("ana", { lastAssignedAt: "2026-10-18T10:00:00Z" }),
      member("beto", { lastAssignedAt: null }),
      member("carla", { lastAssignedAt: "2026-10-18T09:00:00Z" }),
    ];
    expect(decideAssignment(input({ members }))).toMatchObject({ candidates: ["beto", "carla", "ana"] });
  });

  it("lee el modo sin equipos desde settings", () => {
    expect(assignmentModeFromSettings({ assignment_mode: "least_load" })).toBe("least_load");
    expect(assignmentModeFromSettings({ assignment_mode: "otro" })).toBe("round_robin");
    expect(assignmentModeFromSettings(null)).toBe("round_robin");
  });
});

describe("pickAssignee", () => {
  it("round_robin: last_assigned_at más antiguo, null primero, desempate por id", () => {
    const c: PickCandidate[] = [
      { userId: "b", lastAssignedAt: "2026-10-18T10:00:00Z", openCount: 0 },
      { userId: "c", lastAssignedAt: null, openCount: 5 },
      { userId: "a", lastAssignedAt: null, openCount: 9 },
    ];
    expect(pickAssignee(c, "round_robin")).toBe("a");
  });

  it("least_load: menos abiertas, desempate por last_assigned_at", () => {
    const c: PickCandidate[] = [
      { userId: "a", lastAssignedAt: null, openCount: 3 },
      { userId: "b", lastAssignedAt: "2026-10-18T10:00:00Z", openCount: 1 },
      { userId: "c", lastAssignedAt: "2026-10-18T09:00:00Z", openCount: 1 },
    ];
    expect(pickAssignee(c, "least_load")).toBe("c");
  });

  it("manual o sin candidatos: nadie", () => {
    expect(pickAssignee([{ userId: "a", lastAssignedAt: null, openCount: 0 }], "manual")).toBeNull();
    expect(pickAssignee([], "round_robin")).toBeNull();
  });

  it("por turnos reparte parejo entre varios miembros simulados", () => {
    const state = new Map(["ana", "beto", "carla", "dani"].map((id) => [id, null as string | null]));
    const counts = new Map<string, number>();
    const sequence: string[] = [];
    for (let i = 0; i < 12; i++) {
      const pick = pickAssignee(
        [...state].map(([userId, lastAssignedAt]) => ({ userId, lastAssignedAt, openCount: 0 })),
        "round_robin",
      ) as string;
      sequence.push(pick);
      counts.set(pick, (counts.get(pick) ?? 0) + 1);
      state.set(pick, new Date(Date.UTC(2026, 9, 18, 10, i)).toISOString());
    }
    expect([...counts.values()]).toEqual([3, 3, 3, 3]);
    // Nunca la misma persona dos veces seguidas.
    expect(sequence.every((p, i) => i === 0 || p !== sequence[i - 1])).toBe(true);
  });

  it("menor carga reparte hacia quien tiene menos abiertas", () => {
    const load = new Map([
      ["ana", 4],
      ["beto", 0],
      ["carla", 1],
    ]);
    const last = new Map<string, string | null>([...load.keys()].map((k) => [k, null]));
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pick = pickAssignee(
        [...load].map(([userId, openCount]) => ({ userId, openCount, lastAssignedAt: last.get(userId) ?? null })),
        "least_load",
      ) as string;
      picks.push(pick);
      load.set(pick, (load.get(pick) ?? 0) + 1);
      last.set(pick, new Date(Date.UTC(2026, 9, 18, 10, i)).toISOString());
    }
    // Empates de carga: gana quien recibió hace más tiempo.
    expect(picks).toEqual(["beto", "carla", "beto", "carla"]);
  });
});
