import { describe, expect, it } from "vitest";
import { settingsLinksFor } from "./settings-nav";

describe("settingsLinksFor", () => {
  it("Dueño y Administrador ven todos los enlaces, y Correo solo el Dueño", () => {
    expect(settingsLinksFor("admin").map((l) => l.title)).not.toContain("Correo");
    expect(settingsLinksFor("owner").map((l) => l.title)).toContain("Correo");
    for (const role of ["owner", "admin"]) {
      expect(settingsLinksFor(role).map((l) => l.title).filter((t) => t !== "Correo")).toEqual([
        "General",
        "Equipo",
        "Gestiones",
        "Tipos de contacto",
        "Equipos",
        "Horarios",
        "Atención",
        "Código de la app",
        "Respuestas guardadas",
        "Plantillas de WhatsApp",
        "Diccionario de la tienda",
        "Cambiar contraseña",
      ]);
    }
  });

  it("el Miembro solo ve Respuestas guardadas, Plantillas de WhatsApp, el diccionario y Cambiar contraseña", () => {
    const expected = ["Respuestas guardadas", "Plantillas de WhatsApp", "Diccionario de la tienda", "Cambiar contraseña"];
    expect(settingsLinksFor("member").map((l) => l.title)).toEqual(expected);
    expect(settingsLinksFor(null).map((l) => l.title)).toEqual(expected);
  });

  it("apunta a las rutas esperadas", () => {
    const byKey = Object.fromEntries(settingsLinksFor("owner").map((l) => [l.key, l.href]));
    expect(byKey).toMatchObject({
      cases: "/dashboard/settings/cases",
      "contact-types": "/dashboard/settings/contact-types",
      teams: "/dashboard/settings/teams",
      hours: "/dashboard/settings/hours",
      team: "/dashboard/settings/team",
      mail: "/dashboard/settings/correo",
      attention: "/dashboard/settings/attention",
      source: "/dashboard/settings/codigo",
      replies: "/dashboard/settings/replies",
      "whatsapp-templates": "/dashboard/settings/whatsapp-templates",
      dictionary: "/dashboard/settings/dictionary",
      password: "/cuenta/contrasena",
    });
  });
});
