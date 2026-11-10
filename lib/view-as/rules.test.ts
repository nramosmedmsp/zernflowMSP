import { describe, expect, it } from "vitest";
import {
  buildViewAsOptions,
  parseViewAsStartBody,
  viewAsRoleOptionLabel,
  viewAsSectionForPath,
  viewAsStartErrorMessage,
} from "./rules";

const T1 = "8dccc9ac-835d-48f8-b9d8-fc02327aa1aa";
const T2 = "24520ba7-a8d5-4c8d-8023-6ded6b6796ab";
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("opciones del selector", () => {
  const options = buildViewAsOptions({
    viewerId: U(1),
    members: [
      { userId: U(1), name: "Olga", email: "o@x.pe", role: "owner", lastSignInAt: "2026-01-01" },
      { userId: U(2), name: "Ana", email: "a@x.pe", role: "admin", lastSignInAt: "2026-01-01" },
      { userId: U(3), name: "Beto", email: "b@x.pe", role: "member", lastSignInAt: null },
      { userId: U(4), name: "Zoe", email: "z@x.pe", role: "owner", lastSignInAt: "2026-01-01" },
    ],
    teams: [
      { id: T2, name: "Postventa" },
      { id: T1, name: "Ventas" },
      { id: "old", name: "Vieja", archivedAt: "2026-01-01" },
    ],
    teamMembers: [
      { teamId: T1, userId: U(2), role: "supervisor" },
      { teamId: T1, userId: U(3), role: "agent" },
      { teamId: "old", userId: U(3), role: "agent" },
    ],
  });

  it("personas: sin quien mira, con otros Dueños y con invitados pendientes", () => {
    expect(options.people.map((p) => p.name)).toEqual(["Ana", "Beto", "Zoe"]);
    expect(options.people.find((p) => p.name === "Zoe")?.roleLabel).toBe("Dueño");
    expect(options.people.find((p) => p.name === "Beto")?.status).toBe("pending");
    expect(options.people.find((p) => p.name === "Ana")?.status).toBe("active");
  });

  it("equipos de cada persona, sin equipos archivados", () => {
    expect(options.people.find((p) => p.name === "Ana")?.teams).toEqual(["Supervisor de Ventas"]);
    expect(options.people.find((p) => p.name === "Beto")?.teams).toEqual(["Asesor de Ventas"]);
  });

  it("roles: Administrador y Supervisor/Asesor de cada equipo activo", () => {
    expect(options.roles.map((r) => r.label)).toEqual([
      "Administrador",
      "Supervisor de Postventa",
      "Asesor de Postventa",
      "Supervisor de Ventas",
      "Asesor de Ventas",
    ]);
    expect(options.roles[1]).toMatchObject({ role: "supervisor", teamId: T2 });
  });

  it("etiquetas", () => {
    expect(viewAsRoleOptionLabel("admin")).toBe("Administrador");
    expect(viewAsRoleOptionLabel("agent", "Ventas")).toBe("Asesor de Ventas");
  });
});

describe("cuerpo de start", () => {
  it("acepta persona y roles válidos", () => {
    expect(parseViewAsStartBody({ kind: "person", userId: T1 })).toEqual({ ok: true, target: { kind: "person", userId: T1 } });
    expect(parseViewAsStartBody({ kind: "role", role: "admin" })).toEqual({ ok: true, target: { kind: "role", role: "admin" } });
    expect(parseViewAsStartBody({ kind: "role", role: "agent", teamId: T1 })).toEqual({
      ok: true,
      target: { kind: "role", role: "agent", teamId: T1 },
    });
  });

  it("rechaza lo demás", () => {
    for (const body of [
      null,
      [],
      "x",
      {},
      { kind: "person" },
      { kind: "person", userId: "no" },
      { kind: "role", role: "owner" },
      { kind: "role", role: "agent" },
      { kind: "role", role: "agent", teamId: "x" },
      { kind: "other" },
    ]) {
      expect(parseViewAsStartBody(body).ok).toBe(false);
    }
  });

  it("traduce los errores de la base", () => {
    expect(viewAsStartErrorMessage("view_as_not_owner")).toContain("Dueño");
    expect(viewAsStartErrorMessage("boom")).toBe("No se pudo iniciar la vista.");
  });
});

describe("secciones del registro", () => {
  it("traduce con lista fija", () => {
    expect(viewAsSectionForPath("/dashboard/inbox")).toBe("Bandeja");
    expect(viewAsSectionForPath("/dashboard/cases?x=1")).toBe("Gestiones");
    expect(viewAsSectionForPath("/dashboard/contacts/abc")).toBe("Contactos");
    expect(viewAsSectionForPath("/dashboard/settings/replies")).toBe("Respuestas guardadas");
    expect(viewAsSectionForPath("/dashboard/settings/team")).toBe("Configuración");
  });
  it("lo desconocido no se registra", () => {
    expect(viewAsSectionForPath("/api/v1/messages")).toBeNull();
    expect(viewAsSectionForPath("/dashboard/inboxx")).toBeNull();
    expect(viewAsSectionForPath(42)).toBeNull();
    expect(viewAsSectionForPath("/dashboard/inbox/" + "a".repeat(400))).toBeNull();
  });
});
