import { describe, expect, it } from "vitest";
import { readAllPages } from "./paging";

/** Tabla de n filas servida con el corte de 1 000 por respuesta, como PostgREST. */
function table(n: number, cap = 1000) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + cap - 1, n - 1);
    return { data: Array.from({ length: Math.max(0, end - from + 1) }, (_, i) => from + i), error: null };
  };
  return { fetchPage, calls };
}

describe("readAllPages", () => {
  it("lee 2 500 filas completas aunque cada respuesta se corte en 1 000", async () => {
    const t = table(2500);
    const r = await readAllPages(t.fetchPage, { max: 50_000 });
    expect(r.rows).toHaveLength(2500);
    expect(r.rows[2499]).toBe(2499);
    expect(r.truncated).toBe(false);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("exactamente un múltiplo de la página no pide de más ni inventa filas", async () => {
    const r = await readAllPages(table(2000).fetchPage, { max: 50_000 });
    expect(r.rows).toHaveLength(2000);
    expect(r.truncated).toBe(false);
  });

  it("al llegar al tope avisa que falta información", async () => {
    const r = await readAllPages(table(5000).fetchPage, { max: 3000 });
    expect(r.rows).toHaveLength(3000);
    expect(r.truncated).toBe(true);
  });

  it("si la tabla mide justo el tope, no hay recorte", async () => {
    const r = await readAllPages(table(3000).fetchPage, { max: 3000 });
    expect(r.rows).toHaveLength(3000);
    expect(r.truncated).toBe(false);
  });

  it("un error se devuelve, no se calla", async () => {
    const r = await readAllPages(async () => ({ data: null, error: { message: "boom" } }), { max: 10 });
    expect(r.error).toBe("boom");
  });
});
