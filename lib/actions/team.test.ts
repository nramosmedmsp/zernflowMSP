// Quitar a una persona del espacio: R2-13 (solo el Dueño quita a un
// Administrador) y R2-2 (su trabajo se reparte).

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "", role: "owner" as string }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId, name: "Tienda" },
    role: state.role,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));
vi.mock("@/lib/flow-engine/case-triggers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flow-engine/case-triggers")>();
  return { ...actual, runCaseEventFlows: vi.fn(async () => {}) };
});

import { removeTeamMember } from "./team";

const WS = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const ADMIN2 = randomUUID();
const ANA = randomUUID();
const BETO = randomUUID();

let fake: FakeDb;
const as = (userId: string, role: string) => {
  state.userId = userId;
  state.role = role;
};
const members = () => fake.rows("workspace_members").map((m) => m.user_id);

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  as(OWNER, "owner");
  fake.seed("workspaces", [{ id: WS, name: "Tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: ADMIN2, role: "admin" },
    { workspace_id: WS, user_id: ANA, role: "member" },
    { workspace_id: WS, user_id: BETO, role: "member" },
  ]);
});

describe("quitar a una persona del espacio", () => {
  it("R2-13: un Administrador no puede quitar a otro Administrador, pero sí a un Miembro", async () => {
    as(ADMIN, "admin");
    expect(await removeTeamMember(WS, ADMIN2)).toEqual({ error: expect.stringContaining("Solo el Dueño puede quitar a un Administrador") });
    expect(members()).toContain(ADMIN2);
    expect(await removeTeamMember(WS, ANA)).toEqual({ ok: true });
    expect(members()).not.toContain(ANA);
  });

  it("R2-13: el Dueño sí puede quitar a un Administrador", async () => {
    expect(await removeTeamMember(WS, ADMIN)).toEqual({ ok: true });
    expect(members()).not.toContain(ADMIN);
  });

  it("R2-13: nadie quita al Dueño ni a sí mismo", async () => {
    expect(await removeTeamMember(WS, OWNER)).toMatchObject({ error: expect.any(String) });
    as(ADMIN, "admin");
    expect(await removeTeamMember(WS, OWNER)).toMatchObject({ error: expect.any(String) });
    expect(await removeTeamMember(WS, ADMIN)).toMatchObject({ error: expect.any(String) });
  });

  it("R2-2: al quitar a un Miembro, sus gestiones quedan sin responsable y sale de los equipos", async () => {
    const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María", owner_id: ANA }]);
    const [c] = fake.seed("cases", [{ workspace_id: WS, contact_id: contact.id, status: "open", assignee_id: ANA }]);
    const team = randomUUID();
    fake.seed("teams", [{ id: team, workspace_id: WS, name: "Ventas" }]);
    fake.seed("team_members", [{ team_id: team, user_id: ANA, role: "agent" }]);
    expect(await removeTeamMember(WS, ANA)).toEqual({ ok: true });
    expect(fake.rows("team_members")).toHaveLength(0);
    expect(fake.rows("contacts").find((x) => x.id === contact.id)!.owner_id).toBeNull();
    const row = fake.rows("cases").find((x) => x.id === c.id)!;
    expect(row.assignee_id === null || row.assignee_id === BETO).toBe(true);
    expect(fake.rows("activity").some((a) => a.type === "unassigned" && a.case_id === c.id)).toBe(true);
  });

  it("un Miembro no puede quitar a nadie", async () => {
    as(ANA, "member");
    expect(await removeTeamMember(WS, BETO)).toMatchObject({ error: expect.any(String) });
    expect(members()).toContain(BETO);
  });
});
