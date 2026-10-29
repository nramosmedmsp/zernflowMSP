// B-23: permisos de la API (docs/FASE-1-TECNICO.md 2.3): sin sesión 401, sin
// espacio 404 y solo Dueño o Administrador en lo que modifica la tienda.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null, cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name && state.cookie ? { value: state.cookie } : undefined) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const db = state.db as FakeDb;
    return Object.assign(db, {
      auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
    });
  },
}));

import {
  NO_WORKSPACE_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  requireApiAdmin,
  requireApiMember,
  requireApiOwner,
} from "./api-auth";

let fake: FakeDb;

beforeEach(() => {
  fake = new FakeDb();
  state.db = fake;
  state.userId = "u1";
  state.cookie = undefined;
  fake.seed("workspace_members", [
    { workspace_id: "ws-a", user_id: "owner", role: "owner" },
    { workspace_id: "ws-a", user_id: "admin", role: "admin" },
    { workspace_id: "ws-a", user_id: "u1", role: "member" },
    { workspace_id: "ws-b", user_id: "u1", role: "admin" },
  ]);
});

async function statusOf(guard: Awaited<ReturnType<typeof requireApiMember>>) {
  return guard.ok ? 200 : { status: guard.response.status, body: await guard.response.json() };
}

describe("api-auth", () => {
  it("sin sesión: 401", async () => {
    state.userId = null;
    expect(await statusOf(await requireApiMember())).toEqual({ status: 401, body: { error: UNAUTHORIZED_MESSAGE } });
  });

  it("sin espacio: 404", async () => {
    state.userId = "nadie";
    expect(await statusOf(await requireApiMember())).toEqual({ status: 404, body: { error: NO_WORKSPACE_MESSAGE } });
  });

  it("un miembro entra como miembro pero no como administrador ni como Dueño (403)", async () => {
    state.cookie = "ws-a";
    expect(await statusOf(await requireApiMember())).toBe(200);
    expect((await statusOf(await requireApiAdmin())) as { status: number }).toMatchObject({ status: 403 });
    expect((await statusOf(await requireApiOwner())) as { status: number }).toMatchObject({ status: 403 });
  });

  it("el rol sale del espacio elegido en la cookie, no de otro espacio donde sí es administrador", async () => {
    state.cookie = "ws-a";
    const guard = await requireApiMember();
    expect(guard.ok && guard.ctx.role).toBe("member");
    state.cookie = "ws-b";
    expect(await statusOf(await requireApiAdmin())).toBe(200);
  });

  it("el Dueño y el administrador pasan donde corresponde", async () => {
    state.cookie = "ws-a";
    state.userId = "admin";
    expect(await statusOf(await requireApiAdmin())).toBe(200);
    expect((await statusOf(await requireApiOwner())) as { status: number }).toMatchObject({ status: 403 });
    state.userId = "owner";
    expect(await statusOf(await requireApiOwner())).toBe(200);
  });
});
