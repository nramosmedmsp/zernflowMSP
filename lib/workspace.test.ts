// CONF-02: getWorkspace distingue "la consulta falló" (lanza, sale la pantalla de error)
// de "no tiene membresías" (redirige a /sin-espacio).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  results: [] as Array<{ data: unknown; error: unknown }>,
  calls: 0,
}));

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/view-as/state", () => ({
  getRealSession: async () => ({ user: { id: "u1", email: "a@b.pe", user_metadata: {} }, authSessionId: null }),
  getViewAsState: async () => ({ locked: false, active: false, ended: false, info: null }),
  effectiveUserFor: (real: unknown) => real,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        // Como el constructor de consultas real: cada `await` ejecuta la consulta de nuevo.
        eq: () => ({
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
            const r = state.results[Math.min(state.calls, state.results.length - 1)];
            state.calls += 1;
            return Promise.resolve(r).then(ok, ko);
          },
        }),
      }),
    }),
  }),
}));

import { getWorkspace } from "./workspace";

const ws = { id: "ws1", name: "Muscle", slug: "m" };
const row = { workspace_id: "ws1", role: "owner", availability: "available", workspaces: ws };

beforeEach(() => {
  state.calls = 0;
  state.results = [];
});

describe("getWorkspace (CONF-02)", () => {
  it("con membresía devuelve el espacio", async () => {
    state.results = [{ data: [row], error: null }];
    const res = await getWorkspace();
    expect(res.workspace.id).toBe("ws1");
    expect(res.role).toBe("owner");
  });

  it("lectura buena pero vacía: redirige a /sin-espacio", async () => {
    state.results = [{ data: [], error: null }];
    await expect(getWorkspace()).rejects.toMatchObject({ to: "/sin-espacio" });
  });

  it("fallo pasajero: se reintenta una vez y entra", async () => {
    state.results = [
      { data: null, error: { message: "timeout" } },
      { data: [row], error: null },
    ];
    const res = await getWorkspace();
    expect(res.workspace.id).toBe("ws1");
    expect(state.calls).toBe(2);
  });

  it("fallo persistente: LANZA y no redirige a /sin-espacio", async () => {
    state.results = [{ data: null, error: { message: "caído" } }];
    const err = await getWorkspace().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(Redirect);
    expect((err as Error).name).toBe("IdentityReadError");
  });
});
