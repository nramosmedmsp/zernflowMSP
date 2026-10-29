// B-17: si un mensaje coincide con varias palabras clave, el resultado no puede
// depender del orden en que llegan los disparadores.

import { describe, expect, it } from "vitest";
import { selectTrigger } from "./trigger-matcher";

const kw = (id: string, keywords: Array<string | { value: string; matchType: "exact" | "contains" | "startsWith" }>, priority = 0, matchType?: "exact" | "contains" | "startsWith") => ({
  id,
  type: "keyword",
  priority,
  config: { keywords, ...(matchType ? { matchType } : {}) },
});

describe("desempate de palabras clave", () => {
  const catalogo = kw("t-catalogo", ["precio"]);
  const pedido = kw("t-pedido", ["envío"]);

  it("el mismo mensaje elige siempre el mismo flujo, sin importar el orden de la lista", () => {
    const a = selectTrigger([catalogo, pedido], { text: "precio del envío" }, false);
    const b = selectTrigger([pedido, catalogo], { text: "precio del envío" }, false);
    expect(a?.trigger.id).toBe(b?.trigger.id);
    // Misma coincidencia (contiene) y misma prioridad: gana la palabra más larga ("precio", 6 letras, sobre "envío", 5).
    expect(a?.trigger.id).toBe("t-catalogo");
  });

  it("gana la mayor prioridad aunque su palabra sea más corta", () => {
    const r = selectTrigger([kw("largo", ["precio del producto"]), kw("prioritario", ["precio"], 5)], { text: "precio del producto" }, false);
    expect(r?.trigger.id).toBe("prioritario");
  });

  it("una coincidencia exacta gana a una que solo contiene la palabra", () => {
    const r = selectTrigger(
      [kw("contiene", ["precio"], 0, "contains"), kw("exacta", ["precio"], 0, "exact")],
      { text: "precio" },
      false,
    );
    expect(r?.trigger.id).toBe("exacta");
    expect(r?.reason).toMatchObject({ via: "keyword", matchType: "exact" });
  });

  it("a igualdad de todo, queda el orden de la lista (ya ordenada por prioridad y antigüedad)", () => {
    const x = kw("primero", ["hola"]);
    const y = kw("segundo", ["hola"]);
    expect(selectTrigger([x, y], { text: "hola" }, false)?.trigger.id).toBe("primero");
  });

  it("sin coincidencia sigue la bienvenida y el disparador por defecto", () => {
    const r = selectTrigger([catalogo, { id: "d", type: "default", priority: 0, config: {} }], { text: "otra cosa" }, false);
    expect(r?.trigger.id).toBe("d");
  });
});
