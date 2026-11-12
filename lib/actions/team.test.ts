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

import { createTeamUser, removeTeamMember, sendAccessEmail, updateTeamMember } from "./team";

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
      meta: expect.objectContaining({ action: "member_readded", user_id: CARLA, reset_link_sent: true }),
    });
  });

  it("recibe un enlace de restablecer contraseña (recuperación), aunque nunca haya iniciado sesión", async () => {
    state.authUsers = [authUser(CARLA, "carla@x.pe", { last_sign_in_at: null })];
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({
      ok: true,
      delivery: { sent: true, message: "Se volvió a agregar a Carla Torres y se le envió un enlace para restablecer su contraseña." },
    });
    const { sendAppMail } = await import("@/lib/mail/send");
    const [, to, content] = vi.mocked(sendAppMail).mock.calls.at(-1) as unknown as [unknown, string, { subject: string; text: string }];
    expect(to).toBe("carla@x.pe");
    expect(content.subject).toMatch(/Restablece tu contraseña/);
    expect(content.text).toContain("type=recovery");
  });

  it("si el correo nunca se confirmó se le manda la activación", async () => {
    state.authUsers = [authUser(CARLA, "carla@x.pe", { email_confirmed_at: null, last_sign_in_at: null })];
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({ ok: true, outcome: "readded", delivery: { sent: true } });
  });

  it("sin correo configurado avisa que no se envió el enlace y lo deja en la actividad", async () => {
    state.mailConfigured = false;
    const result = await createTeamUser(WS, input);
    expect(result).toMatchObject({
      ok: true,
      delivery: { sent: false, notConfigured: true, message: expect.stringContaining("no se le envió el enlace para restablecer su contraseña") },
    });
    expect(fake.rows("activity").find((a) => a.type === "config_changed")).toMatchObject({
      meta: expect.objectContaining({ reset_link_sent: false }),
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

describe("varios Dueños: editar usuario", () => {
  const OWNER2 = randomUUID();
  const WS2 = randomUUID();
  const putUser = (id: string, email: string, name: string, extra: Record<string, unknown> = {}) => {
    const user = {
      id,
      email,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-02-01T00:00:00Z",
      user_metadata: { full_name: name },
      ...extra,
    };
    fake.users.set(id, user as never);
    state.authUsers.push(user);
  };
  const roleOf = (id: string) => fake.rows("workspace_members").find((m) => m.user_id === id && m.workspace_id === WS)?.role;
  const edit = (id: string, over: Partial<{ fullName: string; email: string; role: string }> = {}) =>
    updateTeamMember(WS, id, { fullName: "Ana Torres", email: "ana@x.pe", role: "member", ...over });

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    state.mailConfigured = true;
    state.authUsers = [];
    putUser(OWNER, "dueno@x.pe", "Dueña Uno");
    putUser(ANA, "ana@x.pe", "Ana Torres");
    putUser(ADMIN, "admin@x.pe", "Admin Uno");
    putUser(OWNER2, "dueno2@x.pe", "Dueño Dos");
    fake.seed("workspace_members", [{ workspace_id: WS, user_id: OWNER2, role: "owner" }]);
  });

  it("solo un Dueño edita: un Administrador y un Miembro no", async () => {
    as(ADMIN, "admin");
    expect(await edit(ANA, { fullName: "Otra" })).toEqual({ error: expect.stringContaining("Solo un Dueño puede editar") });
    as(ANA, "member");
    expect(await edit(BETO)).toMatchObject({ error: expect.any(String) });
    expect(fake.users.get(ANA)!.user_metadata).toEqual({ full_name: "Ana Torres" });
  });

  it("el Dueño cambia nombre y queda en actividad con quién lo hizo", async () => {
    const result = await edit(ANA, { fullName: "Ana María Torres" });
    expect(result).toMatchObject({ ok: true, emailChanged: false, delivery: null, member: { name: "Ana María Torres" } });
    expect(fake.users.get(ANA)!.user_metadata).toEqual({ full_name: "Ana María Torres" });
    expect(fake.rows("activity")).toEqual([
      expect.objectContaining({
        type: "config_changed",
        actor_id: OWNER,
        from_value: "Ana Torres",
        to_value: "Ana María Torres",
        meta: expect.objectContaining({ action: "member_renamed", user_id: ANA }),
      }),
    ]);
  });

  it("un Dueño nombra Dueño a un Miembro y queda en actividad", async () => {
    expect(await edit(ANA, { role: "owner" })).toMatchObject({ ok: true, member: { role: "owner" } });
    expect(roleOf(ANA)).toBe("owner");
    expect(fake.rows("activity")[0]).toMatchObject({
      actor_id: OWNER,
      from_value: "member",
      to_value: "owner",
      meta: expect.objectContaining({ action: "member_role_changed" }),
    });
  });

  it("un Dueño puede quitarle el rol a otro Dueño si queda al menos uno", async () => {
    expect(await updateTeamMember(WS, OWNER2, { fullName: "Dueño Dos", email: "dueno2@x.pe", role: "admin" })).toMatchObject({ ok: true });
    expect(roleOf(OWNER2)).toBe("admin");
  });

  it("el último Dueño no puede dejar de serlo", async () => {
    fake.rows("workspace_members").find((m) => m.user_id === OWNER2)!.role = "member";
    const result = await updateTeamMember(WS, OWNER, { fullName: "Dueña Uno", email: "dueno@x.pe", role: "admin" });
    expect(result).toEqual({ error: expect.stringContaining("al menos un Dueño") });
    expect(roleOf(OWNER)).toBe("owner");
  });

  it("rechaza un rol inventado y un correo inválido", async () => {
    expect(await edit(ANA, { role: "superadmin" })).toMatchObject({ error: expect.stringContaining("Rol no válido") });
    expect(await edit(ANA, { email: "no-es-correo" })).toEqual({ error: "Escribe un correo válido." });
  });

  it("cambiar el correo actualiza la cuenta, lo registra y envía el acceso al correo nuevo", async () => {
    const result = await edit(ANA, { email: "Ana.Nueva@X.pe" });
    expect(result).toMatchObject({ ok: true, emailChanged: true, delivery: { sent: true }, member: { email: "ana.nueva@x.pe" } });
    expect(fake.users.get(ANA)!.email).toBe("ana.nueva@x.pe");
    expect(fake.rows("activity")[0]).toMatchObject({
      actor_id: OWNER,
      from_value: "ana@x.pe",
      to_value: "ana.nueva@x.pe",
      meta: expect.objectContaining({ action: "member_email_changed" }),
    });
  });

  it("sin correo de la app configurado cambia el correo y ofrece copiar el enlace", async () => {
    state.mailConfigured = false;
    const result = await edit(ANA, { email: "ana.nueva@x.pe" });
    expect(result).toMatchObject({ ok: true, delivery: { sent: false, notConfigured: true } });
    expect(fake.users.get(ANA)!.email).toBe("ana.nueva@x.pe");
  });

  it("no permite un correo que ya usa otra cuenta", async () => {
    expect(await edit(ANA, { email: "admin@x.pe" })).toEqual({ error: "Ya existe una cuenta con ese correo." });
    expect(fake.users.get(ANA)!.email).toBe("ana@x.pe");
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("no asciende a Administrador o Dueño a quien también está en otro espacio", async () => {
    fake.seed("workspaces", [{ id: WS2, name: "Otra", settings: {} }]);
    fake.seed("workspace_members", [
      { workspace_id: WS2, user_id: OWNER, role: "owner" },
      { workspace_id: WS2, user_id: ANA, role: "member" },
    ]);
    expect(await edit(ANA, { role: "admin" })).toEqual({ error: expect.stringContaining("otro espacio de trabajo") });
    expect(roleOf(ANA)).toBe("member");
    // Sí puede cambiarle el nombre: es Dueño también del otro espacio.
    expect(await edit(ANA, { fullName: "Ana T." })).toMatchObject({ ok: true });
  });

  it("no edita a quien está en otro espacio que quien llama no administra", async () => {
    fake.seed("workspaces", [{ id: WS2, name: "Otra", settings: {} }]);
    fake.seed("workspace_members", [{ workspace_id: WS2, user_id: ANA, role: "member" }]);
    expect(await edit(ANA, { fullName: "Otro nombre" })).toEqual({ error: expect.stringContaining("otro espacio de trabajo") });
  });
});

describe("varios Dueños: crear, quitar y enviar acceso", () => {
  const OWNER2 = randomUUID();
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    state.mailConfigured = true;
    state.authUsers = [];
    fake.seed("workspace_members", [{ workspace_id: WS, user_id: OWNER2, role: "owner" }]);
  });

  it("solo un Dueño puede crear a otro Dueño (el servidor lo exige)", async () => {
    as(ADMIN, "admin");
    expect(await createTeamUser(WS, { fullName: "Nuevo Dueño", email: "nuevo@x.pe", role: "owner" })).toEqual({
      error: expect.stringContaining("Solo un Dueño puede nombrar"),
    });
    expect(fake.rows("workspace_invites")).toHaveLength(0);
  });

  it("un Dueño sí puede crear a otro Dueño", async () => {
    state.authUsers = [
      { id: "u-nuevo", email: "nuevo@x.pe", email_confirmed_at: "2026-01-01", last_sign_in_at: "2026-01-02", user_metadata: {} },
    ];
    fake.users.set("u-nuevo", state.authUsers[0] as never);
    const result = await createTeamUser(WS, { fullName: "Nuevo Dueño", email: "nuevo@x.pe", role: "owner" });
    expect(result).toMatchObject({ ok: true, member: { role: "owner" } });
    expect(fake.rows("workspace_members").find((m) => m.user_id === "u-nuevo")).toMatchObject({ role: "owner" });
  });

  it("un Dueño quita a otro Dueño; un Administrador no", async () => {
    as(ADMIN, "admin");
    expect(await removeTeamMember(WS, OWNER2)).toMatchObject({ error: expect.stringContaining("Solo un Dueño puede quitar a otro Dueño") });
    as(OWNER, "owner");
    expect(await removeTeamMember(WS, OWNER2)).toEqual({ ok: true });
    expect(members()).not.toContain(OWNER2);
    expect(fake.rows("activity").find((a) => (a.meta as { action?: string }).action === "member_removed")).toMatchObject({ actor_id: OWNER });
  });

  it("el último Dueño no se quita", async () => {
    as(OWNER2, "owner");
    expect(await removeTeamMember(WS, OWNER)).toEqual({ ok: true });
    // Queda OWNER2 solo: nadie más puede quitarlo (ni él mismo).
    expect(await removeTeamMember(WS, OWNER2)).toMatchObject({ error: expect.any(String) });
    expect(members()).toContain(OWNER2);
  });

  it("un Dueño puede enviar el acceso a otro Dueño; un Administrador no", async () => {
    state.authUsers = [];
    fake.users.set(OWNER2, { id: OWNER2, email: "o2@x.pe", email_confirmed_at: "x", last_sign_in_at: "y", user_metadata: {} } as never);
    state.authUsers.push(fake.users.get(OWNER2)!);
    expect(await sendAccessEmail(WS, OWNER2)).toMatchObject({ ok: true, delivery: { sent: true } });
    as(ADMIN, "admin");
    expect(await sendAccessEmail(WS, OWNER2)).toMatchObject({ error: expect.any(String) });
  });
});
