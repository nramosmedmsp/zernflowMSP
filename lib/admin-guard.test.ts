import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member" as string | null }));
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => ({ role: state.role }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import { ADMIN_HOME, NON_ADMIN_HOME, homePathFor, requireAdminPage } from "./admin-guard";

describe("requireAdminPage", () => {
  beforeEach(() => {
    state.role = "member";
  });

  it("manda al asesor a la Bandeja", async () => {
    await expect(requireAdminPage()).rejects.toThrow(`REDIRECT:${NON_ADMIN_HOME}`);
  });

  it("trata un rol ausente como asesor", async () => {
    state.role = null;
    await expect(requireAdminPage()).rejects.toThrow(`REDIRECT:${NON_ADMIN_HOME}`);
  });

  it("deja pasar al Dueño y al Administrador", async () => {
    state.role = "owner";
    await expect(requireAdminPage()).resolves.toBeUndefined();
    state.role = "admin";
    await expect(requireAdminPage()).resolves.toBeUndefined();
  });
});

describe("homePathFor", () => {
  it("cada rol entra a su pantalla", () => {
    expect(homePathFor("owner")).toBe(ADMIN_HOME);
    expect(homePathFor("admin")).toBe(ADMIN_HOME);
    expect(homePathFor("member")).toBe(NON_ADMIN_HOME);
    expect(homePathFor(undefined)).toBe(NON_ADMIN_HOME);
  });
});
