import { describe, expect, it } from "vitest";
import { decideViewAsRequest, isSameOriginRequest, isStaleViewAsCookie, isViewAsGuardExemptPath } from "./guard";
import type { ViewAsCookie } from "./cookie";

const cookie: ViewAsCookie = { sid: "a", viewer: "b", exp: 10_000 };
const NOW_ACTIVE = 5_000;
const NOW_EXPIRED = 20_000;

const decide = (method: string, pathname: string, c: ViewAsCookie | null, now = NOW_ACTIVE) =>
  decideViewAsRequest({ method, pathname, cookie: c, now });

describe("candado de método y ruta", () => {
  it("sin cookie nada cambia", () => {
    for (const m of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(decide(m, "/api/v1/messages", null).allow).toBe(true);
      expect(decide(m, "/dashboard/inbox", null, NOW_EXPIRED).allow).toBe(true);
    }
  });

  it("vista vigente: escrituras a /api/* bloqueadas, lecturas y server actions pasan", () => {
    expect(decide("GET", "/api/v1/messages", cookie).allow).toBe(true);
    expect(decide("HEAD", "/api/v1/media/1", cookie).allow).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(decide(m, "/api/v1/messages", cookie)).toEqual({ allow: false, reason: "read_only" });
      expect(decide(m, "/api/cron/jobs", cookie)).toEqual({ allow: false, reason: "read_only" });
    }
    // Las lecturas por server action son POST a la página: las frenan el cliente con candado y la base.
    expect(decide("POST", "/dashboard/inbox", cookie).allow).toBe(true);
  });

  it("las rutas de la propia función siempre pasan", () => {
    expect(decide("POST", "/api/v1/view-as/stop", cookie, NOW_EXPIRED).allow).toBe(true);
    expect(decide("POST", "/api/v1/view-as/start", cookie).allow).toBe(true);
    expect(decide("GET", "/api/v1/view-as/options", cookie).allow).toBe(true);
  });

  it("no se cuela por un prefijo parecido", () => {
    expect(decide("POST", "/api/v1/view-asx/stop", cookie).allow).toBe(false);
    expect(decide("POST", "/api/v1/messages/api/v1/view-as/stop", cookie).allow).toBe(false);
  });

  it("vista vencida sin cerrar: ninguna escritura, tampoco server actions", () => {
    expect(decide("POST", "/dashboard/inbox", cookie, NOW_EXPIRED)).toEqual({ allow: false, reason: "expired" });
    expect(decide("POST", "/api/v1/messages", cookie, NOW_EXPIRED)).toEqual({ allow: false, reason: "expired" });
    expect(decide("GET", "/dashboard/inbox", cookie, NOW_EXPIRED).allow).toBe(true);
  });
});

describe("apoyos del candado", () => {
  it("rutas exentas: login y enlaces de acceso", () => {
    expect(isViewAsGuardExemptPath("/login")).toBe(true);
    expect(isViewAsGuardExemptPath("/auth/confirm/verificar")).toBe(true);
    expect(isViewAsGuardExemptPath("/authx")).toBe(false);
    expect(isViewAsGuardExemptPath("/dashboard/inbox")).toBe(false);
  });

  it("cookie de otra persona = vieja", () => {
    expect(isStaleViewAsCookie(cookie, "b")).toBe(false);
    expect(isStaleViewAsCookie(cookie, "otra")).toBe(true);
    expect(isStaleViewAsCookie(null, "otra")).toBe(false);
    expect(isStaleViewAsCookie(cookie, null)).toBe(false);
  });

  it("mismo origen", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isSameOriginRequest(h({ origin: "https://crm.pe", host: "crm.pe" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "https://crm.pe", "x-forwarded-host": "crm.pe", host: "interno" }))).toBe(true);
    expect(isSameOriginRequest(h({ origin: "https://malo.com", host: "crm.pe" }))).toBe(false);
    expect(isSameOriginRequest(h({ host: "crm.pe" }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: "no es url", host: "crm.pe" }))).toBe(false);
  });
});
