import { describe, expect, it } from "vitest";
import {
  buildAutoTemplate,
  customFieldSlug,
  customFieldToken,
  initialMapping,
  isAllowedParam,
  mappingFor,
  paramOptions,
  parseAutoTemplate,
  sampleParamValue,
} from "./auto-template-rules";

const FIELDS = new Set(["plan", "sede_socio"]);

describe("variables permitidas", () => {
  it("acepta las base y los campos personalizados conocidos", () => {
    for (const t of ["{nombre}", "{fecha_clave}", "{empresa}", "{campo:plan}"]) expect(isAllowedParam(t, FIELDS)).toBe(true);
    for (const t of ["{campo:otro}", "{sede}", "nombre", "", "{campo:}"]) expect(isAllowedParam(t, FIELDS)).toBe(false);
  });

  it("arma y lee el token de un campo", () => {
    expect(customFieldToken("plan")).toBe("{campo:plan}");
    expect(customFieldSlug("{campo:plan}")).toBe("plan");
    expect(customFieldSlug("{nombre}")).toBeNull();
  });

  it("lista las opciones con los campos personalizados", () => {
    const o = paramOptions([{ slug: "plan", name: "Plan" }]);
    expect(o.map((x) => x.token)).toEqual(["{nombre}", "{fecha_clave}", "{empresa}", "{campo:plan}"]);
    expect(o[3].label).toBe("Campo: Plan");
  });
});

describe("mapeo", () => {
  it("la primera variable es el nombre", () => {
    expect(initialMapping(3)).toEqual(["{nombre}", "", ""]);
    expect(initialMapping(0)).toEqual([]);
  });

  it("reutiliza lo guardado solo para la misma plantilla y cantidad", () => {
    const cur = { template_name: "renovacion", language: "es", params: ["{nombre}", "{fecha_clave}"] };
    expect(mappingFor(2, cur, "renovacion", "es")).toEqual(["{nombre}", "{fecha_clave}"]);
    expect(mappingFor(3, cur, "renovacion", "es")).toEqual(["{nombre}", "", ""]);
    expect(mappingFor(2, cur, "otra", "es")).toEqual(["{nombre}", ""]);
    expect(mappingFor(2, null, "renovacion", "es")).toEqual(["{nombre}", ""]);
  });

  it("valores de ejemplo", () => {
    const fields = [{ slug: "plan", name: "Plan" }];
    expect(sampleParamValue("{nombre}", fields)).toBe("María");
    expect(sampleParamValue("{campo:plan}", fields)).toBe("(Plan)");
    expect(sampleParamValue("{campo:x}", fields)).toBe("");
  });
});

describe("buildAutoTemplate", () => {
  const base = {
    templateName: "renovacion",
    language: "es",
    params: ["{nombre}", "{fecha_clave}"] as unknown,
    fieldSlugs: FIELDS,
  };

  it("arma { template_name, language, params }", () => {
    expect(buildAutoTemplate({ ...base, slotCount: 2 })).toEqual({
      ok: true,
      value: { template_name: "renovacion", language: "es", params: ["{nombre}", "{fecha_clave}"] },
    });
  });

  it("acepta idiomas con región y plantillas sin variables", () => {
    expect(buildAutoTemplate({ ...base, language: "es_MX", params: [] }).ok).toBe(true);
  });

  it("rechaza variables vacías o desconocidas", () => {
    expect(buildAutoTemplate({ ...base, params: ["{nombre}", ""] }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, params: ["{nombre}", "{campo:otro}"] }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, params: ["{nombre}", 5] }).ok).toBe(false);
  });

  it("rechaza datos mal formados o cantidad distinta", () => {
    expect(buildAutoTemplate({ ...base, templateName: " " }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, language: "español" }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, params: "x" }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, slotCount: 3 }).ok).toBe(false);
    expect(buildAutoTemplate({ ...base, params: Array(21).fill("{nombre}") }).ok).toBe(false);
  });
});

describe("parseAutoTemplate", () => {
  it("lee el jsonb guardado", () => {
    expect(parseAutoTemplate({ template_name: "a", language: "es", params: ["{nombre}", 3] })).toEqual({
      template_name: "a",
      language: "es",
      params: ["{nombre}"],
    });
    expect(parseAutoTemplate({ template_name: "a", language: "es" })?.params).toEqual([]);
  });

  it("devuelve null si no sirve", () => {
    for (const raw of [null, undefined, [], "x", {}, { template_name: "a" }, { language: "es" }]) {
      expect(parseAutoTemplate(raw)).toBeNull();
    }
  });
});
