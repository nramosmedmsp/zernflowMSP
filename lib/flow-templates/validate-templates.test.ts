import { describe, expect, it } from "vitest";
import { BUSINESS_TEMPLATES } from "@/lib/business-templates";
import { validateFlowGraph } from "@/lib/flow-engine/validate";
import { FLOW_TEMPLATES } from "./index";
import { resolveFlowTemplate } from "./resolve";
import type { TemplateCatalog } from "./types";

let n = 0;
const id = (p: string) => `${p}-${++n}`;
const catalog: TemplateCatalog = {
  caseTypes: [...BUSINESS_TEMPLATES.ecommerce.caseTypes, ...BUSINESS_TEMPLATES.gym.caseTypes].map((t) => ({
    id: id("tipo"),
    name: t.name,
    stages: t.stages.map((s) => ({ id: id("etapa"), name: s.name, kind: s.kind })),
    categories: (t.categories ?? []).map((c) => ({ id: id("cat"), name: c.name })),
  })),
  teams: ["Atención", "Sede 1", "Sede 2", "Sede 3"].map((name) => ({ id: id("equipo"), name })),
  contactTypes: [{ id: id("ct"), name: "Prospecto" }],
};

// Instalar una plantilla y publicarla no debe toparse con los errores de la
// revisión previa (M-26): solo con avisos, que son opcionales.
describe("plantillas frente a la revisión de publicación", () => {
  for (const template of FLOW_TEMPLATES) {
    it(`${template.id} no tiene errores`, () => {
      const flow = resolveFlowTemplate(template, catalog);
      const errors = validateFlowGraph(flow.nodes as never, flow.edges as never).filter((i) => i.severity === "error");
      expect(errors, JSON.stringify(errors)).toEqual([]);
    });
  }
});
