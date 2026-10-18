import { describe, expect, it } from "vitest";
import { isNavActive, navigationFor } from "./sidebar-nav";

const names = (role: string | null | undefined) => navigationFor(role).map((e) => e.name);

describe("navigationFor", () => {
  it("Dueño y Administrador ven todo, con Gestiones debajo de Bandeja", () => {
    const all = [
      "Flujos",
      "Bandeja",
      "Gestiones",
      "Contactos",
      "Difusiones",
      "Secuencias",
      "Analítica",
      "Crecimiento",
      "Canales",
      "Configuración",
    ];
    expect(names("owner")).toEqual(all);
    expect(names("admin")).toEqual(all);
  });

  it("el Miembro ve solo Bandeja, Gestiones, Contactos y Configuración", () => {
    expect(names("member")).toEqual(["Bandeja", "Gestiones", "Contactos", "Configuración"]);
  });

  it("un rol desconocido o ausente se trata como Miembro", () => {
    for (const role of [null, undefined, "", "superadmin"]) {
      expect(names(role)).toEqual(["Bandeja", "Gestiones", "Contactos", "Configuración"]);
    }
  });

  it("los enlaces apuntan a las rutas del panel", () => {
    const hrefs = navigationFor("member").map((e) => e.href);
    expect(hrefs).toEqual([
      "/dashboard/inbox",
      "/dashboard/cases",
      "/dashboard/contacts",
      "/dashboard/settings",
    ]);
  });
});

describe("isNavActive", () => {
  it("coincide con la ruta y sus subrutas, no con prefijos parciales", () => {
    expect(isNavActive("/dashboard/cases", "/dashboard/cases")).toBe(true);
    expect(isNavActive("/dashboard/cases/123", "/dashboard/cases")).toBe(true);
    expect(isNavActive("/dashboard/cases-viejas", "/dashboard/cases")).toBe(false);
    expect(isNavActive("/dashboard/inbox", "/dashboard/cases")).toBe(false);
    expect(isNavActive(null, "/dashboard/cases")).toBe(false);
  });
});
