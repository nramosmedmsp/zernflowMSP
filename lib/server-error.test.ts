import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_SERVER_ERROR, serverError } from "./server-error";

describe("serverError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("responde con el texto genérico y deja el detalle solo en el log", async () => {
    const res = serverError("flows", { message: 'relation "flows" does not exist', code: "42P01" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: GENERIC_SERVER_ERROR }));
    expect(text).not.toMatch(/relation|42P01|flows/);
    expect(console.error).toHaveBeenCalledWith("[flows]", expect.objectContaining({ code: "42P01" }));
  });

  it("acepta un texto y un código propios", async () => {
    const res = serverError("canal", new Error("boom"), "No se pudo desconectar el canal.", 502);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No se pudo desconectar el canal." });
  });
});
