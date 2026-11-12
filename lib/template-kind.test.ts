import { describe, expect, it } from "vitest";
import { templateGateView, templateKindLabel } from "./template-kind";
import { NO_CONSENT_MESSAGE, OPTED_OUT_MESSAGE } from "./consent";

describe("etiquetas de plantilla", () => {
  it("usa Servicio y Publicidad", () => {
    expect(templateKindLabel("service")).toBe("Servicio");
    expect(templateKindLabel("marketing")).toBe("Publicidad");
    expect(templateKindLabel("unknown")).toBe("Publicidad");
  });
});

describe("templateGateView", () => {
  it("servicio sale a cualquiera", () => {
    for (const cat of ["UTILITY", "AUTHENTICATION"]) {
      expect(templateGateView({ marketing_status: "opted_out" }, cat).locked).toBe(false);
      expect(templateGateView({ marketing_status: "unknown" }, cat).label).toBe("Servicio");
    }
  });
  it("publicidad solo a quien aceptó", () => {
    expect(templateGateView({ marketing_status: "accepted" }, "MARKETING").locked).toBe(false);
    const sin = templateGateView({ marketing_status: "unknown" }, "MARKETING");
    expect(sin).toMatchObject({ locked: true, reason: "unknown", message: NO_CONSENT_MESSAGE, label: "Publicidad" });
    expect(templateGateView({ marketing_status: "opted_out" }, "MARKETING").message).toBe(OPTED_OUT_MESSAGE);
  });
  it("baja por is_subscribed o datos borrados cuenta como baja", () => {
    expect(templateGateView({ marketing_status: "accepted", is_subscribed: false }, "MARKETING").reason).toBe("opted_out");
    expect(templateGateView({ marketing_status: "accepted", erased_at: "2026-01-01" }, "MARKETING").locked).toBe(true);
  });
  it("categoría desconocida o contacto ausente se trata como publicidad", () => {
    expect(templateGateView({ marketing_status: "accepted" }, "FOO").locked).toBe(false);
    const v = templateGateView(null, "");
    expect(v.locked).toBe(true);
    expect(v.publicity).toBe(true);
  });
});
