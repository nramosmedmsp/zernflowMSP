import { describe, expect, it } from "vitest";
import { parseBroadcastContent, parseTemplateContent } from "./content";
import { buildContactTemplateParams, needsCustomFields } from "./variables";

const vars = {
  displayName: "Ana María Pérez",
  keyDate: "2026-11-30",
  workspaceName: "Muscle Shop",
  customFields: { plan: "Mensual", "sede-favorita": "Surco" },
};

describe("buildContactTemplateParams", () => {
  it("reemplaza nombre (primer nombre), fecha clave (dd/mm/aaaa), empresa y campos personalizados", () => {
    const r = buildContactTemplateParams(
      { params: ["{nombre}", "{fecha_clave}", "{empresa}", "{campo:plan}", "Tu sede: {campo:sede-favorita}"] },
      vars,
    );
    expect(r).toEqual({ ok: true, params: ["Ana", "30/11/2026", "Muscle Shop", "Mensual", "Tu sede: Surco"] });
  });

  it("cada contacto recibe sus propios valores", () => {
    const template = { params: ["{nombre}", "{fecha_clave}"] };
    const a = buildContactTemplateParams(template, { ...vars, displayName: "Luis Ramos", keyDate: "2026-12-01" });
    const b = buildContactTemplateParams(template, { ...vars, displayName: "Rosa Díaz", keyDate: "2027-01-15" });
    expect(a).toEqual({ ok: true, params: ["Luis", "01/12/2026"] });
    expect(b).toEqual({ ok: true, params: ["Rosa", "15/01/2027"] });
  });

  it("falla con un mensaje claro si una variable queda vacía", () => {
    const sinFecha = buildContactTemplateParams({ params: ["{fecha_clave}"] }, { ...vars, keyDate: null });
    expect(sinFecha.ok).toBe(false);
    if (!sinFecha.ok) expect(sinFecha.error).toContain("quedó vacía");

    const sinCampo = buildContactTemplateParams({ params: ["{campo:plan}"] }, { ...vars, customFields: {} });
    expect(sinCampo.ok).toBe(false);
  });

  it("un nombre que es un teléfono o un correo no se usa como nombre", () => {
    expect(buildContactTemplateParams({ params: ["{nombre}"] }, { ...vars, displayName: "+51 987 654 321" }).ok).toBe(false);
    expect(buildContactTemplateParams({ params: ["{nombre}"] }, { ...vars, displayName: "ana@correo.com" }).ok).toBe(false);
    // Con texto alrededor el saludo queda sin nombre y sigue siendo válido.
    expect(buildContactTemplateParams({ params: ["Hola {nombre}!"] }, { ...vars, displayName: null })).toEqual({
      ok: true,
      params: ["Hola!"],
    });
  });

  it("limpia saltos de línea del valor", () => {
    const r = buildContactTemplateParams({ params: ["{campo:plan}"] }, { ...vars, customFields: { plan: "Mensual\ngold" } });
    expect(r).toEqual({ ok: true, params: ["Mensual gold"] });
  });

  it("needsCustomFields detecta los campos personalizados", () => {
    expect(needsCustomFields(["{nombre}", "{CAMPO:plan}"])).toBe(true);
    expect(needsCustomFields(["{nombre}"])).toBe(false);
  });
});

describe("contenido de la difusión", () => {
  it("lee texto (con o sin kind) y plantilla", () => {
    expect(parseBroadcastContent({ text: " Hola " })).toEqual({ kind: "text", text: "Hola" });
    expect(parseBroadcastContent({ kind: "text", text: "Hola" })).toEqual({ kind: "text", text: "Hola" });
    expect(
      parseBroadcastContent({ kind: "template", template_name: " promo ", language: "es", params: ["{nombre}", 3] }),
    ).toEqual({ kind: "template", template_name: "promo", language: "es", params: ["{nombre}"] });
  });

  it("rechaza contenido vacío o incompleto", () => {
    expect(parseBroadcastContent({})).toBeNull();
    expect(parseBroadcastContent({ kind: "text", text: "  " })).toBeNull();
    expect(parseBroadcastContent({ kind: "template", template_name: "", language: "es" })).toBeNull();
    expect(parseBroadcastContent(null)).toBeNull();
    expect(parseTemplateContent({ template_name: "x" })).toBeNull();
  });
});
