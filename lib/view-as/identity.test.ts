// Identidad efectiva con "Ver como": api-auth, loadWorkspaceActor y utilidades.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { parseViewAsInfo, viewAsActorOverride, type ViewAsInfo } from "./rules";
import type { ViewAsState } from "./state";

const st = vi.hoisted(() => ({ db: null as unknown, view: null as unknown, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "zernflow_workspace_id" && st.cookie ? { value: st.cookie } : undefined),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    Object.assign(st.db as FakeDb, {
      auth: { getUser: async () => ({ data: { user: { id: "owner", email: "o@x.pe", user_metadata: { full_name: "Olga" }, app_metadata: { p: 1 } } } }) },
    }),
}));
vi.mock("@/lib/view-as/state", async () => {
  const actual = await vi.importActual<typeof import("./state")>("./state");
  return { ...actual, getViewAsState: async () => st.view };
});

import { requireApiAdmin, requireApiMember } from "@/lib/api-auth";
import { loadWorkspaceActor } from "@/lib/cases/visibility";

const info = (over: Partial<ViewAsInfo> = {}): ViewAsInfo => ({
  sessionId: "s1",
  workspaceId: "ws-a",
  viewerId: "owner",
  kind: "person",
  targetUserId: "ana",
  label: "Ana",
  detail: null,
  name: "Ana",
  email: "ana@x.pe",
  roleWs: null,
  teamId: null,
  teamName: null,
  teamRole: null,
  startedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-01T00:30:00Z",
  ...over,
});
const active = (i: ViewAsInfo): ViewAsState => ({ locked: true, active: true, ended: false, info: i });

let fake: FakeDb;
beforeEach(() => {
  fake = new FakeDb();
  st.db = fake;
  st.cookie = undefined;
  st.view = { locked: false, active: false, ended: false, info: null } satisfies ViewAsState;
  fake.seed("workspace_members", [
    { workspace_id: "ws-a", user_id: "owner", role: "owner" },
    { workspace_id: "ws-b", user_id: "owner", role: "owner" },
    { workspace_id: "ws-a", user_id: "ana", role: "member" },
    { workspace_id: "ws-b", user_id: "ana", role: "admin" },
  ]);
});

describe("api-auth con Ver como", () => {
  it("sin vista: el Dueño es el Dueño", async () => {
    const g = await requireApiAdmin();
    expect(g.ok && g.ctx.user.id).toBe("owner");
    expect(g.ok && g.ctx.role).toBe("owner");
  });

  it("vista de una persona: id y rol son los de la persona, y el espacio queda fijado al de la vista", async () => {
    st.view = active(info());
    st.cookie = "ws-b"; // la cookie del selector apunta a otro espacio: se ignora
    const g = await requireApiMember();
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.ctx.user.id).toBe("ana");
    expect(g.ctx.user.email).toBe("ana@x.pe");
    expect(g.ctx.workspaceId).toBe("ws-a");
    expect(g.ctx.role).toBe("member");
    // la persona es miembro, no administradora: requireApiAdmin responde 403 como a ella
    const admin = await requireApiAdmin();
    expect(admin.ok ? 200 : admin.response.status).toBe(403);
  });

  it("vista por rol: no hay fila de membresía, el rol sale de la vista", async () => {
    st.view = active(info({ kind: "role", targetUserId: "fake-1", roleWs: "admin", name: "Administrador", email: null }));
    const g = await requireApiAdmin();
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.ctx.user.id).toBe("fake-1");
    expect(g.ctx.role).toBe("admin");
    expect(g.ctx.workspaceId).toBe("ws-a");
  });
});

describe("loadWorkspaceActor con identidad de ejemplo", () => {
  beforeEach(() => {
    fake.seed("workspaces", [{ id: "ws-a", settings: { agent_visibility: "team" } }]);
    fake.seed("teams", [
      { id: "t-v", workspace_id: "ws-a", name: "Ventas", is_default: true, archived_at: null },
      { id: "t-p", workspace_id: "ws-a", name: "Postventa", is_default: false, archived_at: null },
    ]);
    fake.seed("team_members", [{ team_id: "t-v", user_id: "ana", role: "agent" }]);
  });

  it("sin override lee las tablas reales", async () => {
    const a = await loadWorkspaceActor(fake as never, "ws-a", "ana");
    expect(a.role).toBe("member");
    expect(a.memberships).toEqual([{ teamId: "t-v", role: "agent" }]);
  });

  it("con override usa el rol y el equipo de la vista y no toca las tablas de membresía", async () => {
    const override = viewAsActorOverride(info({ kind: "role", roleWs: "member", teamId: "t-p", teamRole: "supervisor" }));
    const a = await loadWorkspaceActor(fake as never, "ws-a", "fake-1", override);
    expect(a.role).toBe("member");
    expect(a.memberships).toEqual([{ teamId: "t-p", role: "supervisor" }]);
    expect(a.workspaceHasTeams).toBe(true);
    expect(a.agentVisibility).toBe("team");
  });

  it("un equipo archivado o ajeno no cuenta", async () => {
    const override = viewAsActorOverride(info({ kind: "role", roleWs: "member", teamId: "t-x", teamRole: "agent" }));
    const a = await loadWorkspaceActor(fake as never, "ws-a", "fake-1", override);
    expect(a.memberships).toEqual([]);
  });
});

describe("utilidades", () => {
  it("override: solo para identidades de ejemplo", () => {
    expect(viewAsActorOverride(info())).toBeNull();
    expect(viewAsActorOverride(null)).toBeNull();
    expect(viewAsActorOverride(info({ kind: "role", roleWs: "admin" }))).toEqual({ role: "admin", memberships: [] });
  });

  it("parseViewAsInfo acepta lo que devuelve la base y rechaza lo demás", () => {
    const raw = {
      session_id: "s", workspace_id: "w", viewer_id: "v", kind: "role", target_user_id: "t", label: "Asesor de Ventas",
      detail: "Ejemplo", name: "Asesor de Ventas", email: null, role_ws: "member", team_id: "x", team_name: "Ventas",
      team_role: "agent", started_at: "a", expires_at: "b",
    };
    expect(parseViewAsInfo(raw)).toMatchObject({ kind: "role", roleWs: "member", teamRole: "agent", teamName: "Ventas", email: null });
    expect(parseViewAsInfo(null)).toBeNull();
    expect(parseViewAsInfo({ ...raw, kind: "otro" })).toBeNull();
    expect(parseViewAsInfo({ ...raw, session_id: "" })).toBeNull();
    expect(parseViewAsInfo([])).toBeNull();
  });
});
