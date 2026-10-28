import { describe, expect, it } from "vitest";
import { ZernioApiError } from "@zernio/node";
import { zernioErrorMessage, zernioThrown } from "./zernio-error";

describe("zernioThrown", () => {
  it("convierte el error que lanza el SDK al formato de respuesta", () => {
    const err = new ZernioApiError("Bad", 400, undefined, undefined, { error: "Recipient not reachable" });
    const result = zernioThrown(err);
    expect(result).toEqual({ error: { error: "Recipient not reachable" }, response: { status: 400 } });
    expect(zernioErrorMessage(result!, "Zernio rechazó el mensaje")).toBe("Zernio rechazó el mensaje (Recipient not reachable)");
  });

  it("deja pasar los errores que no son de Zernio (sin conexión, bugs)", () => {
    expect(zernioThrown(new TypeError("fetch failed"))).toBeNull();
    expect(zernioThrown(null)).toBeNull();
    expect(zernioThrown("x")).toBeNull();
  });
});
