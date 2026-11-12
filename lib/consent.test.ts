import { describe, expect, it } from "vitest";
import {
  NO_CONSENT_MESSAGE,
  OPTED_OUT_MESSAGE,
  UNKNOWN_CATEGORY_NOTICE,
  availableConsentActions,
  buildConsentChange,
  marketingDecision,
  marketingSourceLabel,
  marketingStatusLabel,
  normalizeMarketingStatus,
  templateSendDecision,
  validateConsentNote,
} from "./consent";

describe("estado de consentimiento", () => {
  it("lo desconocido o dañado cuenta como sin registrar", () => {
    expect(normalizeMarketingStatus(undefined)).toBe("unknown");
    expect(normalizeMarketingStatus(null)).toBe("unknown");
    expect(normalizeMarketingStatus("otra cosa")).toBe("unknown");
    expect(normalizeMarketingStatus("accepted")).toBe("accepted");
    expect(normalizeMarketingStatus("opted_out")).toBe("opted_out");
  });

  it("etiquetas en español claro", () => {
    expect(marketingStatusLabel("unknown")).toBe("Sin registrar");
    expect(marketingStatusLabel("accepted")).toBe("Aceptó publicidad");
    expect(marketingStatusLabel("opted_out")).toBe("De baja de publicidad");
    expect(marketingSourceLabel("keyword")).toBe("palabra clave del cliente");
    expect(marketingSourceLabel(null)).toBeNull();
  });

  it("ofrece los botones según el estado", () => {
    expect(availableConsentActions("unknown")).toEqual(["accept", "opt_out"]);
    expect(availableConsentActions("accepted")).toEqual(["opt_out"]);
    expect(availableConsentActions("opted_out")).toEqual(["reactivate"]);
    expect(availableConsentActions(undefined)).toEqual(["accept", "opt_out"]);
  });
});

describe("nota del cambio", () => {
  it("la nota es opcional al registrar el consentimiento", () => {
    expect(validateConsentNote("accept", "")).toEqual({ ok: true, note: null });
    expect(validateConsentNote("accept", "  me lo dijo   por teléfono ")).toEqual({ ok: true, note: "me lo dijo por teléfono" });
  });

  it("reactivar exige anotar la evidencia", () => {
    expect(validateConsentNote("reactivate", "")).toMatchObject({ ok: false });
    expect(validateConsentNote("reactivate", "ok")).toMatchObject({ ok: false });
    expect(validateConsentNote("reactivate", "Escribió por WhatsApp el 3/11 pidiendo ofertas")).toMatchObject({ ok: true });
  });

  it("rechaza notas demasiado largas", () => {
    expect(validateConsentNote("accept", "a".repeat(501))).toMatchObject({ ok: false });
  });
});

describe("buildConsentChange", () => {
  const at = "2026-11-12T10:00:00.000Z";

  it("aceptar deja fecha, origen y quién, y mantiene is_subscribed", () => {
    const c = buildConsentChange({ from: "unknown", action: "accept", source: "manual", by: "u1", note: "n", at });
    expect(c.patch).toEqual({
      marketing_status: "accepted",
      marketing_status_at: at,
      marketing_source: "manual",
      marketing_set_by: "u1",
      marketing_note: "n",
      is_subscribed: true,
    });
    expect(c.activity).toEqual({ type: "contact_subscribed", from: "unknown", to: "accepted" });
  });

  it("la baja apaga is_subscribed y queda en el historial como baja", () => {
    const c = buildConsentChange({ from: "accepted", action: "opt_out", source: "keyword", by: null, note: null, at });
    expect(c.patch.is_subscribed).toBe(false);
    expect(c.patch.marketing_status).toBe("opted_out");
    expect(c.patch.marketing_set_by).toBeNull();
    expect(c.activity.type).toBe("contact_unsubscribed");
  });

  it("reactivar vuelve a 'aceptó'", () => {
    const c = buildConsentChange({ from: "opted_out", action: "reactivate", source: "manual", by: "u1", note: "evidencia", at });
    expect(c.patch.marketing_status).toBe("accepted");
    expect(c.patch.is_subscribed).toBe(true);
    expect(c.activity).toMatchObject({ from: "opted_out", to: "accepted" });
  });
});

describe("¿se le puede enviar publicidad?", () => {
  it("solo a quien aceptó", () => {
    expect(marketingDecision({ marketing_status: "accepted" })).toEqual({ ok: true });
    expect(marketingDecision({ marketing_status: "unknown" })).toMatchObject({ ok: false, reason: "unknown", message: NO_CONSENT_MESSAGE });
    expect(marketingDecision({ marketing_status: "opted_out" })).toMatchObject({ ok: false, reason: "opted_out", message: OPTED_OUT_MESSAGE });
    expect(marketingDecision(null)).toMatchObject({ ok: false, reason: "unknown" });
    expect(marketingDecision({})).toMatchObject({ ok: false });
  });
});

describe("plantillas según su categoría", () => {
  it("una plantilla de servicio sale a cualquiera, también a quien se dio de baja", () => {
    for (const status of ["unknown", "accepted", "opted_out"]) {
      expect(templateSendDecision({ marketing_status: status }, "service")).toEqual({ allowed: true });
    }
  });

  it("una de publicidad exige consentimiento", () => {
    expect(templateSendDecision({ marketing_status: "accepted" }, "marketing")).toEqual({ allowed: true });
    expect(templateSendDecision({ marketing_status: "unknown" }, "marketing")).toMatchObject({
      allowed: false,
      reason: "unknown",
      message: NO_CONSENT_MESSAGE,
    });
    expect(templateSendDecision({ marketing_status: "opted_out" }, "marketing")).toMatchObject({
      allowed: false,
      reason: "opted_out",
      message: OPTED_OUT_MESSAGE,
    });
  });

  it("si no se sabe la categoría se trata como publicidad y se le explica a la persona", () => {
    const d = templateSendDecision({ marketing_status: "opted_out" }, "unknown");
    expect(d).toMatchObject({ allowed: false });
    expect(d.allowed === false && d.message.startsWith(UNKNOWN_CATEGORY_NOTICE)).toBe(true);
    expect(templateSendDecision({ marketing_status: "accepted" }, "unknown")).toEqual({ allowed: true });
  });
});
