import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTemplateKindCache,
  demoTemplateKind,
  isPublicityKind,
  readTemplateKind,
  templateKindFromCategory,
  type TemplateReader,
} from "./template-category";

vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: vi.fn() }));

function reader(result: () => Promise<unknown>): TemplateReader & { calls: number } {
  const r = {
    calls: 0,
    whatsapp: {
      getWhatsAppTemplate: async () => {
        r.calls++;
        return (await result()) as never;
      },
    },
  };
  return r;
}

beforeEach(() => clearTemplateKindCache());

describe("categoría de la plantilla", () => {
  it("UTILITY y AUTHENTICATION son de servicio; MARKETING, de publicidad", () => {
    expect(templateKindFromCategory("UTILITY")).toBe("service");
    expect(templateKindFromCategory("authentication")).toBe("service");
    expect(templateKindFromCategory(" Marketing ")).toBe("marketing");
  });

  it("lo que no se reconoce queda desconocido y cuenta como publicidad", () => {
    for (const v of [undefined, null, "", "OTRA", 3]) expect(templateKindFromCategory(v)).toBe("unknown");
    expect(isPublicityKind("unknown")).toBe(true);
    expect(isPublicityKind("marketing")).toBe(true);
    expect(isPublicityKind("service")).toBe(false);
  });

  it("las plantillas de prueba traen su categoría", () => {
    expect(demoTemplateKind("recordatorio_recompra")).toBe("marketing");
    expect(demoTemplateKind("seguimiento_pedido")).toBe("service");
    expect(demoTemplateKind("no_existe")).toBe("unknown");
  });
});

describe("lectura desde Zernio", () => {
  it("lee la categoría y la recuerda un rato", async () => {
    const r = reader(async () => ({ data: { template: { category: "UTILITY" } } }));
    expect(await readTemplateKind(r, "acc", "pedido", 1000)).toBe("service");
    expect(await readTemplateKind(r, "acc", "pedido", 2000)).toBe("service");
    expect(r.calls).toBe(1);
    // Vencida la memoria, vuelve a preguntar.
    expect(await readTemplateKind(r, "acc", "pedido", 1000 + 6 * 60 * 1000)).toBe("service");
    expect(r.calls).toBe(2);
  });

  it("un error de Zernio o una plantilla ausente es desconocido y no se recuerda", async () => {
    const failing = reader(async () => ({ error: { status: 500 } }));
    expect(await readTemplateKind(failing, "acc", "x")).toBe("unknown");
    expect(await readTemplateKind(failing, "acc", "x")).toBe("unknown");
    expect(failing.calls).toBe(2);
    const missing = reader(async () => ({ data: { template: null } }));
    expect(await readTemplateKind(missing, "acc", "y")).toBe("unknown");
  });

  it("si la llamada lanza, queda desconocido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = reader(async () => {
      throw new Error("red caída");
    });
    expect(await readTemplateKind(r, "acc", "z")).toBe("unknown");
  });

  it("la memoria distingue cuentas y nombres", async () => {
    const r = reader(async () => ({ data: { template: { category: "MARKETING" } } }));
    await readTemplateKind(r, "a1", "t");
    await readTemplateKind(r, "a2", "t");
    await readTemplateKind(r, "a1", "u");
    expect(r.calls).toBe(3);
  });
});
