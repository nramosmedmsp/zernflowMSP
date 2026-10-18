import { describe, expect, it } from "vitest";
import {
  buildCreateComponents,
  buildTemplateParams,
  extractPlaceholders,
  fillPlaceholders,
  isSendable,
  normalizeTemplateName,
  renderTemplatePreview,
  sanitizeTemplateParam,
  suggestFirstParam,
  summarizeTemplate,
  templateStatusLabel,
  validateTemplateCreate,
} from "./whatsapp-templates";

const raw = {
  id: "123",
  name: "recordatorio_recompra",
  status: "APPROVED",
  category: "UTILITY",
  language: "es",
  components: [
    { type: "HEADER", format: "TEXT", text: "Hola {{1}}" },
    { type: "BODY", text: "Tu plan {{1}} vence el {{2}}. ¿Lo renovamos?" },
    { type: "FOOTER", text: "Muscle Shop" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Sí" },
        { type: "URL", text: "Renovar", url: "https://x.pe/r/{{1}}" },
      ],
    },
  ],
};

describe("extractPlaceholders", () => {
  it("devuelve las variables distintas en orden de aparición", () => {
    expect(extractPlaceholders("{{2}} y {{1}} y {{2}}")).toEqual(["2", "1"]);
    expect(extractPlaceholders("Hola {{ nombre }} de {{empresa}}")).toEqual(["nombre", "empresa"]);
    expect(extractPlaceholders("Sin variables")).toEqual([]);
    expect(extractPlaceholders(null)).toEqual([]);
  });
});

describe("summarizeTemplate", () => {
  it("resume encabezado, cuerpo, pie, botones y variables", () => {
    const t = summarizeTemplate(raw);
    expect(t).toMatchObject({
      id: "123",
      name: "recordatorio_recompra",
      language: "es",
      category: "UTILITY",
      status: "APPROVED",
      header: "Hola {{1}}",
      headerFormat: "TEXT",
      body: "Tu plan {{1}} vence el {{2}}. ¿Lo renovamos?",
      footer: "Muscle Shop",
      variableCount: 4,
    });
    expect(t.buttons).toEqual([
      { type: "QUICK_REPLY", text: "Sí" },
      { type: "URL", text: "Renovar" },
    ]);
    expect(t.slots.map((s) => s.section)).toEqual(["header", "body", "body", "button"]);
  });

  it("acepta componentes en minúsculas y una plantilla sin variables", () => {
    const t = summarizeTemplate({
      name: "hola",
      status: "pending",
      language: "es",
      components: [{ type: "body", text: "Hola, ¿cómo estás?" }],
    });
    expect(t.variableCount).toBe(0);
    expect(t.status).toBe("PENDING");
    expect(t.header).toBeNull();
  });

  it("un encabezado de imagen no cuenta como variable ni como texto", () => {
    const t = summarizeTemplate({
      name: "foto",
      status: "APPROVED",
      language: "es",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Mira {{1}}" },
      ],
    });
    expect(t.header).toBeNull();
    expect(t.headerFormat).toBe("IMAGE");
    expect(t.variableCount).toBe(1);
  });

  it("no falla con datos incompletos", () => {
    expect(summarizeTemplate(null).name).toBe("");
    expect(summarizeTemplate({ name: "x" }).body).toBe("");
  });
});

describe("renderTemplatePreview / fillPlaceholders", () => {
  const t = summarizeTemplate(raw);

  it("llena encabezado y cuerpo con los valores en orden", () => {
    const p = renderTemplatePreview(t, ["Ana", "Anual", "30/10", "abc"]);
    expect(p.header).toBe("Hola Ana");
    expect(p.body).toBe("Tu plan Anual vence el 30/10. ¿Lo renovamos?");
    expect(p.footer).toBe("Muscle Shop");
  });

  it("deja la variable visible mientras falte el valor", () => {
    const p = renderTemplatePreview(t, ["Ana", "", ""]);
    expect(p.body).toBe("Tu plan {{1}} vence el {{2}}. ¿Lo renovamos?");
  });

  it("repite el mismo valor si la variable aparece dos veces", () => {
    expect(fillPlaceholders("{{1}} y {{1}}", ["Ana"])).toBe("Ana y Ana");
  });

  it("funciona con variables con nombre", () => {
    expect(fillPlaceholders("Hola {{nombre}}, {{plan}}", ["Ana", "Anual"])).toBe("Hola Ana, Anual");
  });
});

describe("buildTemplateParams", () => {
  const t = summarizeTemplate(raw);

  it("arma el arreglo plano, limpiando cada valor", () => {
    expect(buildTemplateParams(t, [" Ana ", "Plan\nAnual", "30/10", "abc"])).toEqual({
      ok: true,
      params: ["Ana", "Plan Anual", "30/10", "abc"],
    });
  });

  it("falla si falta alguno e indica cuál", () => {
    const r = buildTemplateParams(t, ["Ana", "Anual", "", "abc"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/variable 2/i);
  });

  it("sin variables devuelve un arreglo vacío", () => {
    expect(buildTemplateParams({ slots: [] }, [])).toEqual({ ok: true, params: [] });
  });
});

describe("sanitizeTemplateParam", () => {
  it("quita saltos, tabulaciones y espacios en exceso", () => {
    expect(sanitizeTemplateParam("a\n\tb      c")).toBe("a b   c");
  });
});

describe("suggestFirstParam", () => {
  it("usa el primer nombre si parece un nombre", () => {
    expect(suggestFirstParam("María Pérez")).toBe("María");
    expect(suggestFirstParam("  juan  ")).toBe("juan");
  });
  it("no sugiere teléfonos, correos ni usuarios con números", () => {
    expect(suggestFirstParam("+51 999 888 777")).toBe("");
    expect(suggestFirstParam("ana@correo.com")).toBe("");
    expect(suggestFirstParam("user1234")).toBe("");
    expect(suggestFirstParam("A")).toBe("");
    expect(suggestFirstParam(undefined)).toBe("");
  });
});

describe("isSendable / templateStatusLabel", () => {
  it("solo las aprobadas se envían", () => {
    expect(isSendable({ status: "APPROVED", name: "a", language: "es" })).toBe(true);
    expect(isSendable({ status: "PENDING", name: "a", language: "es" })).toBe(false);
    expect(isSendable({ status: "APPROVED", name: "a", language: "" })).toBe(false);
  });
  it("traduce los estados", () => {
    expect(templateStatusLabel("APPROVED")).toBe("Aprobada");
    expect(templateStatusLabel("rejected")).toBe("Rechazada");
    expect(templateStatusLabel("RARO")).toBe("RARO");
  });
});

describe("normalizeTemplateName", () => {
  it("pasa a minúsculas, sin tildes y con guion bajo", () => {
    expect(normalizeTemplateName("Recordatorio de Recompra")).toBe("recordatorio_de_recompra");
    expect(normalizeTemplateName("  Última-compra!! ")).toBe("ultima_compra");
  });
});

describe("validateTemplateCreate", () => {
  const base = {
    name: "Recordatorio",
    category: "utility",
    body: "Hola {{1}}, tu plan vence el {{2}}. Responde para renovar.",
    examples: ["Ana", "30/10"],
  };

  it("acepta una plantilla válida con idioma es por defecto", () => {
    expect(validateTemplateCreate(base)).toEqual({
      ok: true,
      value: {
        name: "recordatorio",
        language: "es",
        category: "UTILITY",
        body: base.body,
        examples: ["Ana", "30/10"],
      },
    });
  });

  it("exige variables en orden", () => {
    expect(validateTemplateCreate({ ...base, body: "Hola {{2}}, ok.", examples: ["a", "b"] }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, body: "A {{1}} y {{3}} fin.", examples: ["a", "b"] }).ok).toBe(false);
  });

  it("no deja empezar ni terminar con variable", () => {
    expect(validateTemplateCreate({ ...base, body: "{{1}} hola", examples: ["a"] }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, body: "hola {{1}}", examples: ["a"] }).ok).toBe(false);
  });

  it("exige un ejemplo por variable", () => {
    expect(validateTemplateCreate({ ...base, examples: ["Ana"] }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, examples: ["Ana", " "] }).ok).toBe(false);
  });

  it("valida categoría, idioma, nombre y cuerpo", () => {
    expect(validateTemplateCreate({ ...base, category: "AUTHENTICATION" }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, language: "español" }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, language: "es_MX" }).ok).toBe(true);
    expect(validateTemplateCreate({ ...base, name: "9abc" }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, name: "  " }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, body: " " }).ok).toBe(false);
    expect(validateTemplateCreate({ ...base, body: "x".repeat(1025), examples: [] }).ok).toBe(false);
  });

  it("una plantilla sin variables no pide ejemplos", () => {
    const r = validateTemplateCreate({ name: "hola", category: "MARKETING", body: "Hola, mira nuestras ofertas." });
    expect(r.ok).toBe(true);
  });
});

describe("buildCreateComponents", () => {
  it("incluye los ejemplos solo si hay variables", () => {
    expect(buildCreateComponents("Hola {{1}} fin", ["Ana"])).toEqual([
      { type: "body", text: "Hola {{1}} fin", example: { body_text: [["Ana"]] } },
    ]);
    expect(buildCreateComponents("Hola", [])).toEqual([{ type: "body", text: "Hola" }]);
  });
});
