import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api-errors";

const res = (status: number, body?: unknown) => ({
  status,
  json: async () => {
    if (body === undefined) throw new Error("sin cuerpo");
    return body;
  },
});

describe("apiErrorMessage", () => {
  it("un 403 dice que falta permiso", async () => {
    expect(await apiErrorMessage(res(403, { error: "x" }), "crear flujos")).toBe("No tienes permiso para crear flujos.");
  });
  it("un 404 pide recargar", async () => {
    expect(await apiErrorMessage(res(404), "guardar el flujo")).toContain("recarga");
  });
  it("usa el mensaje del servidor en otros errores", async () => {
    expect(await apiErrorMessage(res(422, { error: "Falta el disparador" }), "publicar")).toBe("Falta el disparador");
  });
  it("cae al texto genérico", async () => {
    expect(await apiErrorMessage(res(500), "publicar el flujo")).toBe("No se pudo publicar el flujo. Inténtalo de nuevo.");
  });
});
