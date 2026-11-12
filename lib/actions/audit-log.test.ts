import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "admin" as string, loads: 0 }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ workspace: { id: "ws-1" }, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/audit-log", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit-log")>()),
  loadAuditPage: async () => {
    state.loads++;
    return { entries: [], nextCursor: null };
  },
}));

import { loadMoreAuditLog } from "./audit-log";

const CURSOR = "2026-10-29T11:14:00.5+00:00|55";
beforeEach(() => {
  state.loads = 0;
});

describe("loadMoreAuditLog", () => {
  it("Dueño y Administrador reciben la página", async () => {
    for (const role of ["owner", "admin"]) {
      state.role = role;
      expect(await loadMoreAuditLog({}, CURSOR)).toEqual({ entries: [], nextCursor: null });
    }
    expect(state.loads).toBe(2);
  });

  it("un supervisor o asesor (miembro) no recibe nada y no se consulta la base", async () => {
    state.role = "member";
    expect(await loadMoreAuditLog({}, CURSOR)).toEqual({ error: "Solo el Dueño o un Administrador pueden ver el registro de cambios." });
    expect(state.loads).toBe(0);
  });

  it("rechaza una clave de página inválida", async () => {
    state.role = "owner";
    expect(await loadMoreAuditLog({}, "basura")).toHaveProperty("error");
    expect(state.loads).toBe(0);
  });
});
