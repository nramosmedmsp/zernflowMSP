// CONF-02: un fallo de lectura de identidad no es "sin espacio".
import { describe, expect, it, vi } from "vitest";
import { IdentityReadError, readOnceMore } from "./identity-read";

describe("readOnceMore", () => {
  it("devuelve la primera lectura si salió bien (sin repetir)", async () => {
    const read = vi.fn(async () => ({ data: [1], error: null }));
    expect(await readOnceMore(read, 0)).toEqual({ data: [1], error: null });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("repite una vez y se queda con la segunda si ya salió bien", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } })
      .mockResolvedValueOnce({ data: [1], error: null });
    expect(await readOnceMore(read, 0)).toEqual({ data: [1], error: null });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("si falla las dos veces devuelve el error (no lo convierte en vacío)", async () => {
    const read = vi.fn(async () => ({ data: null, error: { message: "caído" } }));
    const res = await readOnceMore(read, 0);
    expect(res.error).toEqual({ message: "caído" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("una excepción de red cuenta como error", async () => {
    const read = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const res = await readOnceMore(read as never, 0);
    expect(res.error).toBeInstanceOf(Error);
  });

  it("una lectura vacía y buena NO se repite: vacío es vacío", async () => {
    const read = vi.fn(async () => ({ data: [], error: null }));
    expect(await readOnceMore(read, 0)).toEqual({ data: [], error: null });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("IdentityReadError", () => {
  it("lleva el origen y el detalle", () => {
    const e = new IdentityReadError("workspace_members", { message: "boom" });
    expect(e.message).toBe("No se pudo leer workspace_members: boom");
    expect(e.name).toBe("IdentityReadError");
  });
});
