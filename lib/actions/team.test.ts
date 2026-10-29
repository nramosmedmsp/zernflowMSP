// Quitar a una persona del espacio: R2-13 (solo el Dueño quita a un
// Administrador) y R2-2 (su trabajo se reparte).

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  fake: null as unknown,
  userId: "",
  workspaceId: "",
  role: "owner" as string,
  authUsers: [] as Array<Record<string, unknown>>,
  mailConfigured: true,
}));

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

vi.mock("@/lib/supabase/extra-rpc", () => ({
  rpcAuthUserExists: async (_s: unknown, email: string) => ({
    exists: state.authUsers.some((u) => u.email === email),
    error: null,
  }),
}));
vi.mock("@/lib/supabase/admin-users", () => ({
  findAuthUserByEmail: async (_s: unknown, email: string) =>
    state.authUsers.find((u) => u.email === email) ?? null,
  generateAccessLink: async (_s: unknown, p: { email: string; type: string }) => ({
    ok: true,
    url: `https://app.test/auth/confirm?type=${p.type}`,
    user: state.authUsers.find((u) => u.email === p.email),
    type: p.type,
  }),
}));
vi.mock("@/lib/mail/settings", () => ({ isMailConfigured: async () => state.mailConfigured }));
vi.mock("@/lib/mail/send", () => ({ sendAppMail: vi.fn(async () => ({ ok: true })) }));

import { createTeamUser, removeTeamMember } from "./team";

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

describe("A-1: volver a agregar a una persona que ya tiene cuenta", () => {
  const WS2 = randomUUID();
  const OTRO_DUENO = randomUUID();
  const CARLA = randomUUID();
  const authUser = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
    id,
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-02-01T00:00:00Z",
    user_metadata: { full_name: "Carla Torres" },
    ...extra,
  });
  const inWs = () => fake.rows("workspace_members").filter((m) => m.workspace_id === WS).map((m) => m.user_id);
  const input = { fullName: "Carla Torres", email: "carla@x.pe", role: "member" };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    state.mailConfigured = true;
    state.authUsers = [authUser(CARLA, "carla@x.pe")];
    fake.seed("workspaces", [{ id: WS2, name: "Otra tienda", settings: {} }]);
  });

  it("quien fue quitada del espacio vuelve a entrar con el rol pedido, queda en actividad y recibe el correo", async () => {
    const result = await createTeamUser(WS, { ...input, role: "admin" });
    expect(result).toMatchObject({ ok: true, outcome: "readded", delivery: { sent: true } });
    expect(fake.rows("workspace_members").find((m) => m.user_id === CARLA)).toMatchObject({ workspace_id: WS, role: "admin" });
    expect(fake.rows("activity").find((a) => a.type === "config_changed")).toMatchObject({
      actor_id: OWNER,
      meta: expect.objectContaining({ action: "member_readded", user_id: CARLA }),
    });
  });

  it("sin correo configurado igual la agrega y ofrece copiar el enlace", async () => {
    state.mailConfigured = false;
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({ ok: true, outcome: "readded", delivery: { sent: false, notConfigured: true } });
    expect(inWs()).toContain(CARLA);
  });

  it("si ya es miembro del espacio no se duplica", async () => {
    fake.seed("workspace_members", [{ workspace_id: WS, user_id: CARLA, role: "member" }]);
    expect(await createTeamUser(WS, input)).toEqual({ error: "Esta persona ya es miembro del espacio de trabajo." });
    expect(fake.rows("workspace_members").filter((m) => m.user_id === CARLA)).toHaveLength(1);
  });

  it("un Miembro no puede agregar a nadie", async () => {
    as(ANA, "member");
    expect(await createTeamUser(WS, input)).toMatchObject({ error: expect.any(String) });
    expect(inWs()).not.toContain(CARLA);
  });

  it("C-1: no se adjunta a quien es Dueño o Administrador de otro espacio que quien llama no administra", async () => {
    fake.seed("workspace_members", [{ workspace_id: WS2, user_id: CARLA, role: "admin" }]);
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({ error: expect.stringContaining("otro espacio de trabajo que no administras") });
    expect(inWs()).not.toContain(CARLA);
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("no se agrega a un Administrador de otro espacio ni aunque quien llama también administre ese espacio", async () => {
    fake.seed("workspace_members", [
      { workspace_id: WS2, user_id: OWNER, role: "owner" },
      { workspace_id: WS2, user_id: CARLA, role: "admin" },
    ]);
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({ error: expect.stringContaining("Dueño o Administrador de otro espacio") });
    expect(inWs()).not.toContain(CARLA);
  });

  it("una Miembro de otro espacio que quien llama administra sí se puede agregar", async () => {
    fake.seed("workspace_members", [
      { workspace_id: WS2, user_id: OWNER, role: "owner" },
      { workspace_id: WS2, user_id: CARLA, role: "member" },
    ]);
    expect(await createTeamUser(WS, input)).toMatchObject({ ok: true, outcome: "readded" });
  });

  it("los mensajes de error no prometen una invitación que no existe", async () => {
    fake.seed("workspace_members", [{ workspace_id: WS2, user_id: CARLA, role: "owner" }]);
    const result = await createTeamUser(WS, input);
    expect(JSON.stringify(result)).not.toMatch(/invitaci/i);
  });
});
