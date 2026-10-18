import { describe, it, expect } from "vitest";
import {
  SET_PASSWORD_PATH,
  confirmNextPath,
  isSignupRequiresInviteError,
  parseEmailOtpType,
  roleLabel,
  safeNextPath,
  sameEmail,
  translatePasswordUpdateError,
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

describe("parseEmailOtpType", () => {
  it("acepta solo los tipos de enlace conocidos", () => {
    for (const type of ["invite", "recovery", "magiclink", "email", "signup", "email_change"]) {
      expect(parseEmailOtpType(type)).toBe(type);
    }
  });

  it("rechaza tipos desconocidos o vacíos", () => {
    expect(parseEmailOtpType(null)).toBeNull();
    expect(parseEmailOtpType("")).toBeNull();
    expect(parseEmailOtpType("sms")).toBeNull();
    expect(parseEmailOtpType("INVITE")).toBeNull();
    expect(parseEmailOtpType("invite ")).toBeNull();
  });
});

describe("confirmNextPath", () => {
  it("respeta un next interno", () => {
    expect(confirmNextPath("invite", "/cuenta/contrasena")).toBe("/cuenta/contrasena");
    expect(confirmNextPath("magiclink", "/dashboard/inbox")).toBe("/dashboard/inbox");
  });

  it("lleva a la contraseña por defecto en invitación y recuperación", () => {
    expect(confirmNextPath("invite", null)).toBe(SET_PASSWORD_PATH);
    expect(confirmNextPath("recovery", "https://evil.com")).toBe(SET_PASSWORD_PATH);
  });

  it("lleva al panel en el resto", () => {
    expect(confirmNextPath("signup", null)).toBe("/dashboard");
    expect(confirmNextPath(null, "//evil.com")).toBe("/dashboard");
  });
});

describe("translatePasswordUpdateError", () => {
  it("traduce los errores comunes", () => {
    expect(translatePasswordUpdateError("New password should be different from the old password.")).toMatch(
      /distinta/,
    );
    expect(translatePasswordUpdateError("Auth session missing!")).toMatch(/sesión venció/);
    expect(translatePasswordUpdateError("Password should be at least 6 characters.")).toMatch(/débil/);
    expect(translatePasswordUpdateError("algo raro")).toMatch(/No se pudo guardar/);
  });
});
