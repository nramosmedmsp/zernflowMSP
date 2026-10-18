import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNT_PREFIX, demoTemplateText, demoTemplates, isDemoChannel } from "./demo";
import { isSendable } from "./whatsapp-templates";

describe("isDemoChannel", () => {
  it("reconoce el prefijo demo- en el canal o en el ID de cuenta", () => {
    expect(isDemoChannel({ late_account_id: "demo-whatsapp-001" })).toBe(true);
    expect(isDemoChannel("demo-instagram-001")).toBe(true);
    expect(isDemoChannel(`${DEMO_ACCOUNT_PREFIX}x`)).toBe(true);
  });

  it("rechaza canales reales y valores vacíos", () => {
    expect(isDemoChannel({ late_account_id: "69709fcdc955c6705a96ed84" })).toBe(false);
    expect(isDemoChannel({ late_account_id: "my-demo-account" })).toBe(false);
    expect(isDemoChannel({ late_account_id: "Demo-123" })).toBe(false);
    expect(isDemoChannel({ late_account_id: "" })).toBe(false);
    expect(isDemoChannel({ late_account_id: null })).toBe(false);
    expect(isDemoChannel({})).toBe(false);
    expect(isDemoChannel(null)).toBe(false);
    expect(isDemoChannel(undefined)).toBe(false);
    expect(isDemoChannel("")).toBe(false);
  });
});

describe("plantillas de prueba", () => {
  it("ofrece dos plantillas aprobadas con sus variables", () => {
    const list = demoTemplates();
    expect(list.map((t) => t.name)).toEqual(["recordatorio_recompra", "seguimiento_pedido"]);
    expect(list.every(isSendable)).toBe(true);
    expect(list.map((t) => t.variableCount)).toEqual([1, 2]);
    expect(list[0].body).toContain("{{1}}");
    expect(list[1].body).toContain("{{2}}");
  });

  it("arma el texto con las variables reemplazadas", () => {
    expect(demoTemplateText("recordatorio_recompra", ["Camila"])).toContain("Hola Camila,");
    const text = demoTemplateText("seguimiento_pedido", ["Jorge", "MS-10482"]);
    expect(text).toContain("Hola Jorge");
    expect(text).toContain("MS-10482");
    expect(text).not.toContain("{{");
  });

  it("para una plantilla desconocida deja su nombre y los valores", () => {
    expect(demoTemplateText("otra_plantilla", ["a", "b"])).toBe("Plantilla: otra_plantilla (a, b)");
    expect(demoTemplateText("otra_plantilla", [])).toBe("Plantilla: otra_plantilla");
  });
});
