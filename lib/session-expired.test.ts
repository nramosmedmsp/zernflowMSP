import { describe, expect, it } from "vitest";
import { SESSION_EXPIRED_MESSAGE, errorFromResponse, isSessionExpired, loginHref } from "./session-expired";

describe("sesión vencida", () => {
  it("una respuesta 401 se traduce a un mensaje claro", () => {
    expect(errorFromResponse(401, "No autorizado", "x")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(isSessionExpired(errorFromResponse(401, undefined, "x"))).toBe(true);
  });
  it("otros errores conservan el texto del servidor o el de respaldo", () => {
    expect(errorFromResponse(400, "Texto largo", "x")).toBe("Texto largo");
    expect(errorFromResponse(500, undefined, "No se pudo enviar (500)")).toBe("No se pudo enviar (500)");
    expect(isSessionExpired("otra cosa")).toBe(false);
  });
  it("el enlace de entrada vuelve a una ruta interna y descarta destinos externos", () => {
    expect(loginHref("/dashboard/inbox?contact=1")).toBe("/login?next=%2Fdashboard%2Finbox%3Fcontact%3D1");
    expect(loginHref("//evil.com")).toBe("/login?next=%2Fdashboard%2Finbox");
    expect(loginHref("https://evil.com")).toBe("/login?next=%2Fdashboard%2Finbox");
  });
});
