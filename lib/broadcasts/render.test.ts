// Un mensaje nunca sale vacío ni con llaves sin reemplazar, y un filtro
// incompleto no se guarda (M-28, M-29).

import { describe, expect, it } from "vitest";
import { buildContactTemplateParams, leftoverVariables, renderContactText } from "./variables";
import { describeSegmentFilter, incompleteFilterProblem, type SegmentFilter } from "./segment";
import { validateSequenceSteps } from "./sequence-step";

const vars = { displayName: "María López", keyDate: "2026-11-30", workspaceName: "Muscle Shop" };

describe("renderContactText", () => {
  it("reemplaza las variables conocidas", () => {
    expect(renderContactText("Hola {nombre}, en {empresa} te esperamos hasta el {fecha_clave}", vars)).toEqual({
      ok: true,
      text: "Hola María, en Muscle Shop te esperamos hasta el 30/11/2026",
    });
  });
  it("sin nombre real, {nombre} queda vacío y el texto se limpia (no se excluye)", () => {
    const sinNombre = { ...vars, displayName: "+51 987 654 321" };
    expect(renderContactText("Hola {nombre}, 20% de descuento", sinNombre)).toEqual({ ok: true, text: "Hola, 20% de descuento" });
    expect(renderContactText("Hola {nombre}!", sinNombre)).toEqual({ ok: true, text: "Hola!" });
    expect(renderContactText("Hola {nombre}", { ...vars, displayName: null })).toEqual({ ok: true, text: "Hola" });
    expect(renderContactText("{nombre}, mira esto", { ...vars, displayName: "ana@correo.com" })).toEqual({ ok: true, text: "mira esto" });
    // Solo el nombre es opcional: las demás variables vacías o desconocidas siguen excluyendo.
    expect(renderContactText("Hola {nombre}, {precio}", sinNombre).ok).toBe(false);
    expect(renderContactText("{nombre}", sinNombre)).toEqual({ ok: false, error: "El mensaje está vacío." });
  });
  it("otra variable vacía para ese contacto lo deja sin mensaje", () => {
    expect(renderContactText("Vence el {fecha_clave}", { ...vars, keyDate: null }).ok).toBe(false);
  });
  it("una llave que no es variable no sale tal cual", () => {
    const res = renderContactText("Tu precio es {precio}", vars);
    expect(res).toEqual({ ok: false, error: "El mensaje tiene {precio}, que no es una variable conocida." });
  });
  it("un texto vacío no sale", () => {
    expect(renderContactText("   ", vars)).toEqual({ ok: false, error: "El mensaje está vacío." });
  });
  it("campos personalizados", () => {
    expect(renderContactText("Plan {campo:plan}", { ...vars, customFields: { plan: "Pro" } })).toEqual({ ok: true, text: "Plan Pro" });
    expect(renderContactText("Plan {campo:plan}", vars).ok).toBe(false);
  });
});

describe("variables de plantilla", () => {
  it("rechaza valores con {{1}} o {precio} sin reemplazar", () => {
    expect(buildContactTemplateParams({ params: ["{{1}}"] }, vars).ok).toBe(false);
    expect(buildContactTemplateParams({ params: ["Oferta {precio}"] }, vars).ok).toBe(false);
    expect(buildContactTemplateParams({ params: ["{nombre}"] }, vars)).toEqual({ ok: true, params: ["María"] });
  });
  it("leftoverVariables", () => {
    expect(leftoverVariables("a {x} b {{1}} {x}")).toEqual(["{x}", "{{1}}"]);
  });
});

describe("validateSequenceSteps", () => {
  it("exige al menos un paso de mensaje", () => {
    expect(validateSequenceSteps([])).toMatch(/al menos un paso/);
    expect(validateSequenceSteps([{ type: "delay", delayMinutes: 5 }])).toMatch(/al menos un paso/);
  });
  it("un mensaje sin texto (y sin plantilla) no es válido", () => {
    expect(validateSequenceSteps([{ type: "message", content: "   " }])).toBe("El paso 1 no tiene texto: escribe el mensaje.");
    expect(validateSequenceSteps([{ type: "message", content: "Hola" }])).toBeNull();
  });
  it("una plantilla sin elegir no es válida", () => {
    expect(validateSequenceSteps([{ type: "template", template: null }])).toMatch(/elige una plantilla/);
    expect(
      validateSequenceSteps([{ type: "template", template: { kind: "template", template_name: "promo", language: "es", params: [] } }]),
    ).toBeNull();
  });
  it("una espera necesita minutos", () => {
    expect(validateSequenceSteps([{ type: "message", content: "Hola" }, { type: "delay", delayMinutes: 0 }])).toMatch(/paso 2/);
  });
});

describe("incompleteFilterProblem (M-28)", () => {
  const rule = (field: string, operator: string, value: string) => ({ field, operator, value });
  const filter = (rules: ReturnType<typeof rule>[]): SegmentFilter => ({ combinator: "and", groups: [{ combinator: "and", rules }] });

  it("'Tiene etiqueta' sin elegir etiqueta es incompleto", () => {
    expect(incompleteFilterProblem(filter([rule("has_tag", "equals", "")]))).toMatch(/sin completar/);
  });
  it("reglas completas o sin filtro están bien", () => {
    expect(incompleteFilterProblem(filter([rule("has_tag", "equals", "t1")]))).toBeNull();
    expect(incompleteFilterProblem(filter([rule("is_subscribed", "equals", "")]))).toBeNull();
    expect(incompleteFilterProblem(null)).toBeNull();
    expect(incompleteFilterProblem({ combinator: "and", groups: [] })).toBeNull();
  });
  it("fecha clave y campo personalizado se revisan por su forma", () => {
    expect(incompleteFilterProblem(filter([rule("key_date", "between", "::")]))).not.toBeNull();
    expect(incompleteFilterProblem(filter([rule("key_date", "between", "2026-01-01::")]))).toBeNull();
    expect(incompleteFilterProblem(filter([rule("custom_field", "equals", "plan::")]))).not.toBeNull();
    expect(incompleteFilterProblem(filter([rule("custom_field", "equals", "plan::pro")]))).toBeNull();
  });
  it("un grupo sin reglas es incompleto", () => {
    expect(incompleteFilterProblem({ combinator: "and", groups: [{ combinator: "and", rules: [] }] })).toMatch(/sin reglas/);
  });
  it("describe el filtro en palabras con los nombres", () => {
    const lines = describeSegmentFilter(filter([rule("has_tag", "equals", "t1"), rule("team", "not_equals", "none")]), {
      tag: (v) => (v === "t1" ? "VIP" : undefined),
    });
    expect(lines).toEqual(["Cumple todas: Tiene la etiqueta “VIP”; El equipo no es ninguno"]);
  });
});
