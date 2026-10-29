import { describe, expect, it } from "vitest";
import {
  INVALID_TEMPLATE_REASON,
  NO_CONVERSATION_REASON,
  NO_TEMPLATE_REASON,
  NO_TEXT_REASON,
  decideStepSend,
  validateSequenceSteps,
} from "./sequence-step";
import type { TemplateMessageContent } from "@/lib/types/database";

const TEMPLATE: TemplateMessageContent = {
  kind: "template",
  template_name: "recordatorio",
  language: "es",
  params: ["{nombre}"],
};

describe("decideStepSend", () => {
  it("mensaje con la ventana abierta: envía el texto", () => {
    expect(decideStepSend({ type: "message", content: " Hola " }, "open")).toEqual({ action: "text", text: "Hola" });
  });

  it("mensaje con la ventana cerrada y sin plantilla: falla con el motivo", () => {
    expect(decideStepSend({ type: "message", content: "Hola" }, "closed")).toEqual({
      action: "fail",
      reason: "Pasaron más de 24 horas y el paso no tiene plantilla",
    });
    expect(NO_TEMPLATE_REASON).toBe("Pasaron más de 24 horas y el paso no tiene plantilla");
  });

  it("mensaje con plantilla alternativa: usa la plantilla solo si la ventana está cerrada", () => {
    const step = { type: "message" as const, content: "Hola", template: TEMPLATE };
    expect(decideStepSend(step, "open")).toEqual({ action: "text", text: "Hola" });
    expect(decideStepSend(step, "closed")).toEqual({ action: "template", template: TEMPLATE, viaFallback: true });
    expect(decideStepSend(step, "no_conversation")).toEqual({ action: "template", template: TEMPLATE, viaFallback: true });
  });

  it("sin conversación y sin plantilla: falla con un motivo propio", () => {
    expect(decideStepSend({ type: "message", content: "Hola" }, "no_conversation")).toEqual({
      action: "fail",
      reason: NO_CONVERSATION_REASON,
    });
  });

  it("paso de plantilla: envía la plantilla en cualquier ventana", () => {
    for (const w of ["open", "closed", "no_conversation"] as const) {
      expect(decideStepSend({ type: "template", template: TEMPLATE }, w)).toEqual({
        action: "template",
        template: TEMPLATE,
        viaFallback: false,
      });
    }
  });

  it("paso de plantilla sin plantilla elegida falla", () => {
    expect(decideStepSend({ type: "template", template: null }, "open")).toEqual({
      action: "fail",
      reason: INVALID_TEMPLATE_REASON,
    });
    expect(
      decideStepSend({ type: "template", template: { kind: "template", template_name: "", language: "es", params: [] } }, "open").action,
    ).toBe("fail");
  });

  it("mensaje sin texto: usa la plantilla alternativa o falla", () => {
    expect(decideStepSend({ type: "message", content: "  " }, "open")).toEqual({ action: "fail", reason: NO_TEXT_REASON });
    expect(decideStepSend({ type: "message", content: "", template: TEMPLATE }, "open")).toEqual({
      action: "template",
      template: TEMPLATE,
      viaFallback: true,
    });
  });
});

describe("validateSequenceSteps: variables de plantilla (M-6)", () => {
  const withParams = (params: string[]): TemplateMessageContent => ({ ...TEMPLATE, params });

  it("rechaza un paso de plantilla con alguna variable vacía", () => {
    expect(validateSequenceSteps([{ type: "template", template: withParams(["{nombre}", ""]) }])).toBe(
      "El paso 1 usa una plantilla: completa todas sus variables.",
    );
    expect(validateSequenceSteps([{ type: "template", template: withParams(["{nombre}", "   "]) }])).toMatch(/variables/);
  });

  it("acepta la plantilla con todas sus variables o sin variables", () => {
    expect(validateSequenceSteps([{ type: "template", template: withParams(["{nombre}", "{empresa}"]) }])).toBeNull();
    expect(validateSequenceSteps([{ type: "template", template: withParams([]) }])).toBeNull();
  });

  it("también revisa la plantilla alternativa de un paso de mensaje", () => {
    expect(
      validateSequenceSteps([{ type: "message", content: "Hola", template: withParams(["{nombre}", ""]) }]),
    ).toMatch(/paso 1.*variables/);
    expect(
      validateSequenceSteps([{ type: "message", content: "Hola", template: withParams(["{nombre}"]) }]),
    ).toBeNull();
  });

  it("M-5: un paso en modo alternativa sin plantilla elegida no se puede activar", () => {
    const empty = { kind: "template", template_name: "", language: "", params: [] } as TemplateMessageContent;
    expect(validateSequenceSteps([{ type: "message", content: "Hola", template: empty }])).toMatch(
      /plantilla alternativa/,
    );
    // El paso de solo mensaje (sin plantilla) sigue siendo válido.
    expect(validateSequenceSteps([{ type: "message", content: "Hola", template: null }])).toBeNull();
  });
});
