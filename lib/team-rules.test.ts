import { describe, expect, it } from "vitest";
import {
  COPY_ACTIVE_LINK_DENIED_MESSAGE,
  COPY_PRIVILEGED_LINK_DENIED_MESSAGE,
  CROSS_WORKSPACE_DENIED_MESSAGE,
  canCreateWorkspace,
  canManageMailSettings,
  crossWorkspaceAuthorityError,
  accessLinkTypeFor,
  accessLinkUrl,
  appBaseUrl,
  canManageTeam,
  copyAccessLinkError,
  displayName,
  isAssignableRole,
  memberStatus,
  memberViewFromUser,
  normalizeEmail,
  normalizeFullName,
  removeMemberError,
  sendAccessEmailError,
  translateGenerateLinkError,
} from "./team-rules";

describe("canManageTeam", () => {
  it("permite al Dueño y a los Administradores", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
  });

  it("no permite a Miembros ni a roles desconocidos", () => {
    expect(canManageTeam("member")).toBe(false);
    expect(canManageTeam(null)).toBe(false);
    expect(canManageTeam("superadmin")).toBe(false);
  });
});

describe("isAssignableRole", () => {
  it("solo Miembro o Administrador", () => {
    expect(isAssignableRole("member")).toBe(true);
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
  });
});

describe("removeMemberError", () => {
  const base = { actorId: "a", targetId: "b" };

  it("el Dueño y los Administradores pueden quitar a otros", () => {
    expect(removeMemberError({ ...base, actorRole: "owner", targetRole: "member" })).toBeNull();
    expect(removeMemberError({ ...base, actorRole: "owner", targetRole: "admin" })).toBeNull();
    expect(removeMemberError({ ...base, actorRole: "admin", targetRole: "member" })).toBeNull();
    expect(removeMemberError({ ...base, actorRole: "admin", targetRole: "admin" })).toBeNull();
  });

  it("nadie puede quitar al Dueño", () => {
    expect(removeMemberError({ ...base, actorRole: "admin", targetRole: "owner" })).toMatch(/Dueño/);
    expect(removeMemberError({ ...base, actorRole: "owner", targetRole: "owner" })).toMatch(/Dueño/);
  });

  it("nadie puede quitarse a sí mismo", () => {
    expect(
      removeMemberError({ actorId: "a", targetId: "a", actorRole: "admin", targetRole: "admin" }),
    ).toMatch(/ti mismo/);
  });

  it("un Miembro no puede quitar a nadie", () => {
    expect(removeMemberError({ ...base, actorRole: "member", targetRole: "member" })).toMatch(
      /Solo el Dueño/,
    );
  });
});

describe("sendAccessEmailError y copyAccessLinkError", () => {
  it("permiten enviar correo a cualquier otro miembro, incluido el Dueño", () => {
    expect(sendAccessEmailError({ actorId: "a", actorRole: "admin", targetId: "b" })).toBeNull();
    expect(
      sendAccessEmailError({ actorId: "a", actorRole: "admin", targetId: "b", targetRole: "owner" }),
    ).toBeNull();
  });

  it("no permiten enviar ni copiar para uno mismo o siendo Miembro", () => {
    expect(sendAccessEmailError({ actorId: "a", actorRole: "owner", targetId: "a" })).not.toBeNull();
    expect(sendAccessEmailError({ actorId: "a", actorRole: "member", targetId: "b" })).not.toBeNull();
    expect(
      copyAccessLinkError({
        actorId: "a",
        actorRole: "owner",
        targetId: "a",
        targetRole: "owner",
        targetActive: false,
      }),
    ).not.toBeNull();
  });
});

describe("copyAccessLinkError", () => {
  const base = { actorId: "a", targetId: "b" };

  it("nadie puede copiar su propio enlace, esté activo o pendiente", () => {
    for (const actorRole of ["owner", "admin"]) {
      for (const targetActive of [true, false]) {
        expect(
          copyAccessLinkError({ actorId: "a", targetId: "a", actorRole, targetRole: actorRole, targetActive }),
        ).toMatch(/Cambiar contraseña/);
      }
    }
  });

  it("nadie puede copiar el enlace de un Dueño o Administrador, esté activo o pendiente", () => {
    for (const actorRole of ["owner", "admin"]) {
      for (const targetRole of ["owner", "admin"]) {
        for (const targetActive of [true, false]) {
          expect(copyAccessLinkError({ ...base, actorRole, targetRole, targetActive })).toBe(
            COPY_PRIVILEGED_LINK_DENIED_MESSAGE,
          );
        }
      }
    }
  });

  it("tampoco si el objetivo es Dueño o Administrador en otro espacio", () => {
    for (const other of ["owner", "admin"]) {
      expect(
        copyAccessLinkError({
          ...base,
          actorRole: "owner",
          targetRole: "member",
          targetActive: false,
          targetMemberships: [
            { workspaceId: "w1", role: "member" },
            { workspaceId: "w2", role: other },
          ],
        }),
      ).toBe(COPY_PRIVILEGED_LINK_DENIED_MESSAGE);
    }
  });

  it("Dueño y Administrador pueden copiar el enlace de un Miembro pendiente", () => {
    for (const actorRole of ["owner", "admin"]) {
      expect(
        copyAccessLinkError({
          ...base,
          actorRole,
          targetRole: "member",
          targetActive: false,
          targetMemberships: [{ workspaceId: "w1", role: "member" }],
        }),
      ).toBeNull();
    }
  });

  it("nadie, ni el Dueño, puede copiar el enlace de una cuenta activa", () => {
    for (const actorRole of ["owner", "admin"]) {
      expect(
        copyAccessLinkError({ ...base, actorRole, targetRole: "member", targetActive: true }),
      ).toBe(COPY_ACTIVE_LINK_DENIED_MESSAGE);
    }
    expect(COPY_ACTIVE_LINK_DENIED_MESSAGE).toMatch(/por correo/);
  });

  it("un Miembro no puede copiar ningún enlace", () => {
    for (const targetActive of [true, false]) {
      expect(
        copyAccessLinkError({ ...base, actorRole: "member", targetRole: "member", targetActive }),
      ).toMatch(/Solo el Dueño o un Administrador/);
    }
  });
});

describe("memberStatus", () => {
  it("pendiente si nunca inició sesión", () => {
    expect(memberStatus(null)).toBe("pending");
    expect(memberStatus(undefined)).toBe("pending");
    expect(memberStatus("2026-10-18T12:00:00Z")).toBe("active");
  });
});

describe("accessLinkTypeFor", () => {
  it("invitación si el correo no está confirmado; si no, recuperación", () => {
    expect(accessLinkTypeFor(false)).toBe("invite");
    expect(accessLinkTypeFor(true)).toBe("recovery");
  });
});

describe("accessLinkUrl", () => {
  it("arma el enlace a /auth/confirm con token_hash, type y next", () => {
    const url = new URL(accessLinkUrl("https://crm.example.pe/", "abc123", "invite"));
    expect(url.origin).toBe("https://crm.example.pe");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/cuenta/contrasena");
  });

  it("codifica tokens con caracteres especiales", () => {
    const url = new URL(accessLinkUrl("http://localhost:3000", "a&b=c", "recovery"));
    expect(url.searchParams.get("token_hash")).toBe("a&b=c");
    expect(url.searchParams.get("type")).toBe("recovery");
  });
});

describe("appBaseUrl", () => {
  it("quita la barra final", () => {
    expect(appBaseUrl("https://crm.example.pe/")).toBe("https://crm.example.pe");
    expect(appBaseUrl(" http://localhost:3000 ")).toBe("http://localhost:3000");
  });

  it("rechaza valores vacíos o que no son http(s)", () => {
    expect(appBaseUrl(undefined)).toBeNull();
    expect(appBaseUrl("")).toBeNull();
    expect(appBaseUrl("crm.example.pe")).toBeNull();
    expect(appBaseUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeEmail y normalizeFullName", () => {
  it("normaliza el correo", () => {
    expect(normalizeEmail("  Ana@Tienda.PE ")).toBe("ana@tienda.pe");
    expect(normalizeEmail("ana@tienda")).toBeNull();
    expect(normalizeEmail("ana tienda.pe")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("exige nombre y limita su largo", () => {
    expect(normalizeFullName("  Ana   Pérez ")).toEqual({ name: "Ana Pérez", error: null });
    expect(normalizeFullName("   ").error).toMatch(/nombre/);
    expect(normalizeFullName("x".repeat(101)).error).toMatch(/100/);
  });
});

describe("memberViewFromUser", () => {
  it("arma la fila con nombre, estado y confirmación", () => {
    const view = memberViewFromUser(
      {
        id: "u1",
        email: "ana@tienda.pe",
        last_sign_in_at: null,
        email_confirmed_at: null,
        user_metadata: { full_name: "Ana Pérez" },
      },
      { userId: "u1", role: "member", joinedAt: "2026-10-18T12:00:00Z" },
    );
    expect(view).toMatchObject({ name: "Ana Pérez", status: "pending", emailConfirmed: false });
  });

  it("usa la parte local del correo si no hay nombre", () => {
    expect(displayName({ id: "u", email: "luis@tienda.pe", user_metadata: {} })).toBe("luis");
    expect(displayName(null)).toBe("Sin nombre");
  });
});

describe("translateGenerateLinkError", () => {
  it("traduce los errores de Supabase", () => {
    expect(translateGenerateLinkError("A user with this email address has already been registered", "email_exists")).toMatch(
      /Ya existe/,
    );
    expect(translateGenerateLinkError("Database error saving new user")).toMatch(/00017/);
    expect(translateGenerateLinkError("User not found", "user_not_found")).toMatch(/No encontramos/);
    expect(translateGenerateLinkError(null)).toMatch(/No se pudo generar/);
  });
});

describe("canManageMailSettings", () => {
  it("solo el Dueño", () => {
    expect(canManageMailSettings("owner")).toBe(true);
    for (const role of ["admin", "member", null, undefined, ""]) {
      expect(canManageMailSettings(role)).toBe(false);
    }
  });
});

describe("canCreateWorkspace", () => {
  it("el Dueño de algún espacio puede", () => {
    expect(canCreateWorkspace({ roles: ["member", "owner"], anyWorkspaceExists: true })).toBe(true);
  });
  it("Administrador, Miembro o sin espacios no pueden si ya existen espacios", () => {
    expect(canCreateWorkspace({ roles: ["admin"], anyWorkspaceExists: true })).toBe(false);
    expect(canCreateWorkspace({ roles: ["member"], anyWorkspaceExists: true })).toBe(false);
    expect(canCreateWorkspace({ roles: [], anyWorkspaceExists: true })).toBe(false);
  });
  it("en una instalación nueva (sin espacios) cualquiera puede", () => {
    expect(canCreateWorkspace({ roles: [], anyWorkspaceExists: false })).toBe(true);
  });
});

describe("crossWorkspaceAuthorityError", () => {
  const m = (workspaceId: string, role: string) => ({ workspaceId, role });

  it("permite si el actor supera al objetivo en todos sus espacios", () => {
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("w1", "admin"), m("w2", "owner")],
        targetMemberships: [m("w1", "member"), m("w2", "admin")],
      }),
    ).toBeNull();
  });

  it("rechaza si el objetivo está en un espacio donde el actor no es miembro", () => {
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("w1", "owner")],
        targetMemberships: [m("w1", "member"), m("w2", "member")],
      }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
  });

  it("rechaza si en otro espacio el actor es Miembro o no supera al objetivo", () => {
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("w1", "owner"), m("w2", "member")],
        targetMemberships: [m("w1", "member"), m("w2", "member")],
      }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("w1", "admin")],
        targetMemberships: [m("w1", "admin")],
      }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
  });

  it("nadie supera a un Dueño, ni otro Dueño", () => {
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("w1", "owner")],
        targetMemberships: [m("w1", "owner")],
      }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
  });

  it("el escenario del ataque: Dueño de su espacio propio, asesor en la tienda", () => {
    expect(
      crossWorkspaceAuthorityError({
        actorMemberships: [m("tienda", "member"), m("propio", "owner")],
        targetMemberships: [m("tienda", "owner"), m("propio", "member")],
      }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
  });

  it("rechaza un objetivo sin espacios", () => {
    expect(
      crossWorkspaceAuthorityError({ actorMemberships: [m("w1", "owner")], targetMemberships: [] }),
    ).toBe(CROSS_WORKSPACE_DENIED_MESSAGE);
  });
});
