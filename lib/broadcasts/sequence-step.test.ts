import { describe, expect, it } from "vitest";
import {
  INVALID_TEMPLATE_REASON,
  NO_CONVERSATION_REASON,
  NO_TEMPLATE_REASON,
  NO_TEXT_REASON,
  decideStepSend,
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
