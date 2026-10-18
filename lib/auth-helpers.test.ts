import { describe, it, expect } from "vitest";
import {
  inviteUrl,
  isInviteUsable,
  isSignupRequiresInviteError,
  roleLabel,
  safeNextPath,
  sameEmail,
  validateNewPassword,
} from "./auth-helpers";

describe("safeNextPath", () => {
  it("acepta rutas internas", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/dashboard/inbox?x=1")).toBe("/dashboard/inbox?x=1");
  });

  it("usa el valor por defecto si falta", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("rechaza destinos externos", () => {
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath("evil.com")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeNextPath("/\tevil")).toBe("/dashboard");
  });

  it("respeta un fallback propio", () => {
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });
});

describe("validateNewPassword", () => {
  it("exige mínimo 8 caracteres", () => {
    expect(validateNewPassword("1234567", "1234567")).toMatch(/al menos 8/);
    expect(validateNewPassword("", "")).toMatch(/al menos 8/);
  });

  it("exige que coincida la confirmación", () => {
    expect(validateNewPassword("12345678", "12345679")).toMatch(/no coinciden/);
  });

  it("acepta una contraseña válida", () => {
    expect(validateNewPassword("12345678", "12345678")).toBeNull();
  });
});

describe("isSignupRequiresInviteError", () => {
  it("reconoce los mensajes de Supabase", () => {
    expect(isSignupRequiresInviteError("Database error saving new user")).toBe(true);
    expect(isSignupRequiresInviteError("ERROR: signup_requires_invite (P0001)")).toBe(true);
  });

  it("ignora otros errores", () => {
    expect(isSignupRequiresInviteError("Invalid login credentials")).toBe(false);
    expect(isSignupRequiresInviteError(null)).toBe(false);
  });
});

describe("isInviteUsable", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("acepta una invitación pendiente y vigente", () => {
    expect(isInviteUsable({ status: "pending", expires_at: "2026-10-20T00:00:00Z" }, now)).toBe(true);
  });

  it("rechaza vencidas, aceptadas o sin fecha", () => {
    expect(isInviteUsable({ status: "pending", expires_at: "2026-10-18T11:59:59Z" }, now)).toBe(false);
    expect(isInviteUsable({ status: "accepted", expires_at: "2026-10-20T00:00:00Z" }, now)).toBe(false);
    expect(isInviteUsable({ status: "pending", expires_at: null }, now)).toBe(false);
    expect(isInviteUsable({ status: "pending", expires_at: "no es fecha" }, now)).toBe(false);
  });
});

describe("sameEmail", () => {
  it("ignora mayúsculas y espacios", () => {
    expect(sameEmail(" Ana@Tienda.pe", "ana@tienda.pe ")).toBe(true);
    expect(sameEmail("ana@tienda.pe", "luis@tienda.pe")).toBe(false);
    expect(sameEmail(null, "ana@tienda.pe")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("traduce los roles de la base", () => {
    expect(roleLabel("owner")).toBe("Dueño");
    expect(roleLabel("admin")).toBe("Administrador");
    expect(roleLabel("member")).toBe("Miembro");
    expect(roleLabel(undefined)).toBe("Miembro");
  });
});

describe("inviteUrl", () => {
  it("arma el enlace sin barras dobles", () => {
    expect(inviteUrl("https://crm.example.pe/", "abc")).toBe("https://crm.example.pe/invite/abc");
    expect(inviteUrl("http://localhost:3000", "abc")).toBe("http://localhost:3000/invite/abc");
  });
});
