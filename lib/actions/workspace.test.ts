// Crear espacios: solo el Dueño de alguno, o cualquiera en una instalación nueva.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { CREATE_WORKSPACE_DENIED_MESSAGE } from "@/lib/team-rules";

const state = vi.hoisted(() => ({
  fake: null as unknown,
  userId: "",
  rpcCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => ({
    ...(state.fake as object),
    from: (t: string) => (state.fake as FakeDb).from(t),
    auth: { getUser: async () => ({ data: { user: { id: state.userId } } }) },
  }),
}));
vi.mock("@/lib/supabase/extra-rpc", () => ({
  rpcCreateWorkspace: async () => {
    state.rpcCalls++;
    return { id: "nuevo-ws", error: null };
  },
}));
vi.mock("@/lib/workspace-cookie", () => ({ setWorkspaceCookie: async () => undefined }));

import { createWorkspace } from "./workspace";

const WS = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const MEMBER = randomUUID();
let fake: FakeDb;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  state.rpcCalls = 0;
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda" }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: MEMBER, role: "member" },
  ]);
});

describe("createWorkspace", () => {
  it("Administrador y Miembro no pueden crear espacios", async () => {
    for (const id of [ADMIN, MEMBER]) {
      state.userId = id;
      expect(await createWorkspace("Mi espacio")).toEqual({ error: CREATE_WORKSPACE_DENIED_MESSAGE });
    }
    expect(state.rpcCalls).toBe(0);
  });

  it("el Dueño puede", async () => {
    state.userId = OWNER;
    expect(await createWorkspace("Otro")).toMatchObject({ ok: true });
    expect(state.rpcCalls).toBe(1);
  });

  it("en una instalación sin espacios cualquiera con sesión puede", async () => {
    fake.tables.workspaces = [];
    fake.tables.workspace_members = [];
    state.userId = randomUUID();
    expect(await createWorkspace("Primero")).toMatchObject({ ok: true });
  });
});
