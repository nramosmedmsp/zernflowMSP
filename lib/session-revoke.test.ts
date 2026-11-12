import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRoleDowngrade, revokeUserSessions } from "./session-revoke";

describe("revokeUserSessions", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("llama a revoke_user_sessions con el id de la persona", async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    expect(await revokeUserSessions({ rpc }, "u-1")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("revoke_user_sessions", { p_user_id: "u-1" });
  });

  it("devuelve false (sin lanzar) si la función falla o no existe", async () => {
    expect(await revokeUserSessions({ rpc: async () => ({ data: null, error: { message: "function does not exist" } }) }, "u")).toBe(false);
    expect(await revokeUserSessions({ rpc: async () => { throw new Error("red"); } }, "u")).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("isRoleDowngrade", () => {
  it("solo es bajar cuando el rol nuevo tiene menos poder", () => {
    expect(isRoleDowngrade("owner", "admin")).toBe(true);
    expect(isRoleDowngrade("owner", "member")).toBe(true);
    expect(isRoleDowngrade("admin", "member")).toBe(true);
    expect(isRoleDowngrade("member", "admin")).toBe(false);
    expect(isRoleDowngrade("admin", "admin")).toBe(false);
    expect(isRoleDowngrade("admin", "raro")).toBe(false);
  });
});
