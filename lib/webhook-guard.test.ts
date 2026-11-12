import { describe, expect, it } from "vitest";
import {
  WEBHOOK_MAX_EVENT_AGE_MS,
  WEBHOOK_MAX_FUTURE_SKEW_MS,
  bodyHash,
  checkEventAge,
  webhookEventKey,
} from "./webhook-guard";
import { PROCESSED_RETENTION_MS } from "./inbound-events";

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("webhookEventKey", () => {
  it("usa el id del cuerpo firmado", () => {
    expect(webhookEventKey({ id: " evt-123 " }, '{"id":" evt-123 "}')).toEqual({ id: "evt-123", derived: false });
  });

  it("sin id deriva uno del cuerpo: el mismo cuerpo da el mismo id; otro cuerpo, otro", () => {
    const a = webhookEventKey({}, '{"event":"message.received","a":1}');
    const b = webhookEventKey({}, '{"event":"message.received","a":1}');
    const c = webhookEventKey({}, '{"event":"message.received","a":2}');
    expect(a.derived).toBe(true);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toBe(`body:${bodyHash('{"event":"message.received","a":1}')}`);
  });

  it.each([[""], ["   "], [123], [null], [{ x: 1 }], ["a\nb"], ["x".repeat(201)]])("un id no utilizable (%j) se trata como ausente", (id) => {
    expect(webhookEventKey({ id }, "{}").derived).toBe(true);
  });
});

describe("checkEventAge", () => {
  it("acepta un evento reciente", () => {
    expect(checkEventAge(ago(1000), NOW)).toEqual({ status: "fresh" });
    expect(checkEventAge(ago(60 * 60 * 1000), NOW)).toEqual({ status: "fresh" });
  });

  it("acepta un reintento atrasado de varias horas (reintentos normales de Zernio)", () => {
    expect(checkEventAge(ago(6 * 60 * 60 * 1000), NOW).status).toBe("fresh");
    expect(checkEventAge(ago(30 * 60 * 60 * 1000), NOW).status).toBe("fresh");
  });

  it("descarta lo más viejo que el margen", () => {
    const r = checkEventAge(ago(WEBHOOK_MAX_EVENT_AGE_MS + 1000), NOW);
    expect(r.status).toBe("stale");
    expect(checkEventAge(ago(7 * 24 * 60 * 60 * 1000), NOW).status).toBe("stale");
  });

  it("tolera una diferencia de reloj corta hacia el futuro, pero no una grande", () => {
    expect(checkEventAge(ago(-(WEBHOOK_MAX_FUTURE_SKEW_MS - 1000)), NOW).status).toBe("fresh");
    expect(checkEventAge(ago(-(WEBHOOK_MAX_FUTURE_SKEW_MS + 60_000)), NOW).status).toBe("future");
  });

  it.each([[undefined], [null], [""], ["no es fecha"], [12345]])("sin fecha utilizable (%j) no se puede juzgar", (ts) => {
    expect(checkEventAge(ts, NOW)).toEqual({ status: "unknown" });
  });

  it("el margen es menor que lo que dura la anti-repetición: todo evento admitido sigue reconocible como duplicado", () => {
    expect(WEBHOOK_MAX_EVENT_AGE_MS).toBeLessThan(PROCESSED_RETENTION_MS);
    // Con holgura suficiente para la poda y los relojes.
    expect(PROCESSED_RETENTION_MS - WEBHOOK_MAX_EVENT_AGE_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});
