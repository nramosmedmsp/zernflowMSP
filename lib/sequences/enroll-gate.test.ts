import { describe, expect, it } from "vitest";
import {
  ENROLL_ERASED_MESSAGE,
  ENROLL_NO_CHANNEL_MESSAGE,
  ENROLL_NO_CONSENT_MESSAGE,
  ENROLL_OPTED_OUT_MESSAGE,
  SEQUENCE_NOT_ACTIVE_MESSAGE,
  SEQUENCE_NO_STEPS_MESSAGE,
  contactEnrollGate,
  defaultChannelId,
  enrollConsentStatus,
  sequenceEnrollGate,
} from "./enroll-gate";

describe("sequenceEnrollGate", () => {
  it("exige secuencia activa y con pasos", () => {
    expect(sequenceEnrollGate({ status: "active", stepCount: 2 })).toEqual({ ok: true });
    expect(sequenceEnrollGate({ status: "draft", stepCount: 2 })).toEqual({ ok: false, reason: "not_active", message: SEQUENCE_NOT_ACTIVE_MESSAGE });
    expect(sequenceEnrollGate({ status: "paused", stepCount: 2 })).toMatchObject({ ok: false, reason: "not_active" });
    expect(sequenceEnrollGate({ status: "active", stepCount: 0 })).toEqual({ ok: false, reason: "no_steps", message: SEQUENCE_NO_STEPS_MESSAGE });
  });
  it("el motivo de la secuencia inactiva es el pedido", () => {
    expect(SEQUENCE_NOT_ACTIVE_MESSAGE).toBe("Activa la secuencia para inscribir contactos");
  });
});

describe("contactEnrollGate", () => {
  it("solo deja pasar a quien aceptó publicidad", () => {
    expect(contactEnrollGate({ marketing_status: "accepted", is_subscribed: true })).toEqual({ ok: true });
    expect(contactEnrollGate({ marketing_status: "unknown", is_subscribed: true })).toEqual({ ok: false, reason: "unknown", message: ENROLL_NO_CONSENT_MESSAGE });
    expect(contactEnrollGate({ marketing_status: null })).toMatchObject({ ok: false, reason: "unknown" });
    expect(contactEnrollGate({ marketing_status: "opted_out", is_subscribed: false })).toEqual({ ok: false, reason: "opted_out", message: ENROLL_OPTED_OUT_MESSAGE });
  });
  it("is_subscribed en falso pesa aunque el estado diga que aceptó", () => {
    expect(contactEnrollGate({ marketing_status: "accepted", is_subscribed: false })).toMatchObject({ ok: false, reason: "opted_out" });
  });
  it("un cliente eliminado se dice con el texto de datos eliminados, no «de baja»", () => {
    const gate = contactEnrollGate({ marketing_status: "opted_out", is_subscribed: false, erased_at: "2026-11-01T00:00:00Z" });
    expect(gate).toEqual({ ok: false, reason: "erased", message: ENROLL_ERASED_MESSAGE });
    expect(ENROLL_ERASED_MESSAGE).toContain("se eliminaron");
    expect(ENROLL_ERASED_MESSAGE).not.toContain("baja");
  });
  it("sin canal no se puede, cuando se conoce la cantidad", () => {
    expect(contactEnrollGate({ marketing_status: "accepted" }, { channelCount: 0 })).toEqual({ ok: false, reason: "no_channel", message: ENROLL_NO_CHANNEL_MESSAGE });
    expect(contactEnrollGate({ marketing_status: "accepted" }, { channelCount: 2 })).toEqual({ ok: true });
    expect(contactEnrollGate({ marketing_status: "accepted" })).toEqual({ ok: true });
  });
  it("el permiso pesa más que el canal", () => {
    expect(contactEnrollGate({ marketing_status: "unknown" }, { channelCount: 0 })).toMatchObject({ reason: "unknown" });
  });
});

describe("ayudas de la pantalla", () => {
  it("estado para el chip", () => {
    expect(enrollConsentStatus({ marketing_status: "accepted", is_subscribed: true })).toBe("accepted");
    expect(enrollConsentStatus({ marketing_status: "accepted", is_subscribed: false })).toBe("opted_out");
    expect(enrollConsentStatus({})).toBe("unknown");
  });
  it("canal elegido solo si hay uno", () => {
    expect(defaultChannelId([{ id: "a" }])).toBe("a");
    expect(defaultChannelId([{ id: "a" }, { id: "b" }])).toBe("");
    expect(defaultChannelId([])).toBe("");
  });
});
