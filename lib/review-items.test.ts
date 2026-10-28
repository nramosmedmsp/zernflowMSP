import { describe, expect, it } from "vitest";
import { applyReviewItem, applyReviewItems, buildReviewItems, safeReviewItems, underlineMarks } from "./review-items";
import type { SpellIssue } from "./spell-check";

const issue = (text: string, word: string, suggestions: string[], from = 0): SpellIssue => {
  const start = text.indexOf(word, from);
  return { word, start, end: start + word.length, suggestions };
};
const view = (text: string, issues: SpellIssue[] = []) =>
  buildReviewItems(text, issues).map((i) => `${i.from}→${i.to}:${i.source}${i.safe ? "" : "?"}`);

describe("buildReviewItems: lista fija y preguntas", () => {
  it("una palabra de la lista fija es segura", () => {
    const [item] = buildReviewItems("te paso mi numero", []);
    expect(item).toMatchObject({ from: "numero", to: "número", safe: true, source: "lista", start: 11, end: 17 });
  });

  it("agrupa la pregunta completa cuando falta el signo y hay tildes", () => {
    expect(view("como estas?")).toEqual(["como estas?→¿cómo estás?:pregunta"]);
    expect(view("Hola Ana, como estas?")).toEqual(["como estas?→¿cómo estás?:pregunta"]);
    const [item] = buildReviewItems("Hola Ana, como estas?", []);
    expect(item.underline).toEqual({ start: 10, end: 20 });
    expect(applyReviewItem("Hola Ana, como estas?", item).text).toBe("Hola Ana, ¿cómo estás?");
  });

  it("si falta solo el signo, es un ítem de signo", () => {
    const items = buildReviewItems("tienen stock?", []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ from: "tienen stock?", to: "¿tienen stock?", source: "signo", safe: true });
    expect(items[0].underline).toEqual({ start: 0, end: 6 });
  });

  it("con el signo ya puesto, las tildes de la pregunta van sueltas", () => {
    expect(view("¿como estas?")).toEqual(["como→cómo:pregunta", "estas→estás:pregunta"]);
  });

  it("lo demás de la frase sigue por separado", () => {
    expect(view("la direccion. como estas?")).toEqual(["direccion→dirección:lista", "como estas?→¿cómo estás?:pregunta"]);
  });
});

describe("buildReviewItems: diccionario", () => {
  it("seguro si solo cambia tildes o suena igual; dudoso si no", () => {
    const text = "grasias por el preico de la manana";
    const items = buildReviewItems(text, [
      issue(text, "grasias", ["gracias"]),
      issue(text, "preico", ["precio", "perico"]),
      issue(text, "manana", ["mañana"]),
    ]);
    expect(items.map((i) => [i.from, i.to, i.safe, i.others])).toEqual([
      ["grasias", "gracias", true, []],
      ["preico", "precio", false, ["perico"]],
      ["manana", "mañana", true, []],
    ]);
  });

  it("sin sugerencias: dudoso y sin corrección", () => {
    const text = "el zzzz";
    const [item] = buildReviewItems(text, [issue(text, "zzzz", [])]);
    expect(item).toMatchObject({ to: null, safe: false, source: "diccionario", edits: [] });
    expect(applyReviewItem(text, item).changed).toEqual([]);
  });

  it("si la lista fija y el diccionario marcan lo mismo, gana la lista fija", () => {
    const text = "asi es, grasias. el preico x dc";
    expect(view(text, [issue(text, "asi", ["así"]), issue(text, "grasias", ["gracias"]), issue(text, "preico", ["precio"]), issue(text, "dc", ["de"])])).toEqual([
      "asi→así:lista",
      "grasias→gracias:diccionario",
      "preico→precio:diccionario?",
      "dc→de:diccionario?",
    ]);
  });

  it("tampoco repite una palabra que ya corrige la pregunta", () => {
    const text = "como estas?";
    expect(view(text, [issue(text, "como", ["cómo"]), issue(text, "estas", ["estás"])])).toEqual(["como estas?→¿cómo estás?:pregunta"]);
  });

  it("si el texto cambió, busca la palabra de nuevo y descarta la que ya no está", () => {
    const text = "hola grasias";
    const stale = { word: "grasias", start: 2, end: 9, suggestions: ["gracias"] };
    expect(buildReviewItems(text, [stale])[0]).toMatchObject({ start: 5, end: 12 });
    expect(buildReviewItems("hola gracias", [stale])).toEqual([]);
    // La misma palabra dos veces: una corregida, la otra sigue marcada una sola vez.
    const two = [{ word: "grasias", start: 0, end: 7, suggestions: ["gracias"] }, { word: "grasias", start: 8, end: 15, suggestions: ["gracias"] }];
    expect(buildReviewItems("gracias grasias", two).map((i) => i.start)).toEqual([8]);
  });
});

describe("buildReviewItems: llaves", () => {
  it("avisa de cada llave sin reemplazar, sin corrección", () => {
    const items = buildReviewItems("hola {nombre}, son {precio}", []);
    expect(items.map((i) => [i.from, i.to, i.safe, i.source])).toEqual([
      ["{nombre}", null, false, "llave"],
      ["{precio}", null, false, "llave"],
    ]);
    expect(items[0]).toMatchObject({ start: 5, end: 13 });
  });
});

describe("buildReviewItems: ignorados, orden e ids", () => {
  const text = "asi. {nombre}. como estas? y grasias";
  const issues = [issue(text, "grasias", ["gracias"])];

  it("ordena por posición", () => {
    const items = buildReviewItems(text, issues);
    expect(items.map((i) => i.source)).toEqual(["lista", "llave", "pregunta", "diccionario"]);
    expect(items.map((i) => i.start)).toEqual([...items.map((i) => i.start)].sort((a, b) => a - b));
  });

  it("excluye lo ignorado por clave (palabra normalizada)", () => {
    const keys = buildReviewItems(text, issues).map((i) => i.key);
    expect(keys).toEqual(["asi", "{nombre}", "pregunta:como estas?", "grasias"]);
    for (const key of keys) {
      const left = buildReviewItems(text, issues, new Set([key])).map((i) => i.key);
      expect(left).toEqual(keys.filter((k) => k !== key));
    }
    expect(buildReviewItems("ASI es", [], new Set(["asi"]))).toEqual([]);
  });

  it("los ids no cambian si solo se mueve el resto del texto", () => {
    const a = buildReviewItems("asi y numero", []).map((i) => i.id);
    const b = buildReviewItems("Hola, asi y numero", []).map((i) => i.id);
    expect(b).toEqual(a);
    expect(new Set(buildReviewItems("asi asi asi", []).map((i) => i.id)).size).toBe(3);
  });
});

describe("aplicar ítems", () => {
  it("un ítem devuelve el texto nuevo y el tramo cambiado", () => {
    const text = "dime el numero hoy";
    const [item] = buildReviewItems(text, []);
    expect(applyReviewItem(text, item)).toEqual({ text: "dime el número hoy", changed: [{ start: 8, end: 14 }], caret: 14 });
  });

  it("otra sugerencia del diccionario en lugar de la primera", () => {
    const text = "el preico";
    const [item] = buildReviewItems(text, [issue(text, "preico", ["precio", "perico"])]);
    expect(applyReviewItem(text, item, "perico").text).toBe("el perico");
  });

  it("una pregunta resalta todo lo que cambió", () => {
    const [item] = buildReviewItems("como estas?", []);
    expect(applyReviewItem("como estas?", item)).toMatchObject({ text: "¿cómo estás?", changed: [{ start: 0, end: 11 }] });
  });

  it("todas las seguras de una vez, sin tocar las dudosas", () => {
    const text = "asi. como estas? el preico de la manana {x}";
    const items = buildReviewItems(text, [issue(text, "preico", ["precio"]), issue(text, "manana", ["mañana"])]);
    const safe = safeReviewItems(items);
    expect(safe.map((i) => i.from)).toEqual(["asi", "como estas?", "manana"]);
    const applied = applyReviewItems(text, safe);
    expect(applied.text).toBe("así. ¿cómo estás? el preico de la mañana {x}");
    expect(applied.changed.map((r) => applied.text.slice(r.start, r.end))).toEqual(["así", "¿cómo estás", "mañana"]);
    // Ya no queda nada seguro: el texto corregido solo deja lo dudoso.
    expect(buildReviewItems(applied.text, []).map((i) => i.source)).toEqual(["llave"]);
  });

  it("el mismo resultado se cambie en el orden que se cambie", () => {
    const text = "x favor, tambien la direccion";
    const items = buildReviewItems(text, []);
    expect(applyReviewItems(text, items).text).toBe("por favor, también la dirección");
    expect(applyReviewItems(text, [...items].reverse()).text).toBe("por favor, también la dirección");
  });
});

describe("underlineMarks", () => {
  it("rojo lo seguro, ámbar lo dudoso", () => {
    const text = "asi el preico";
    const marks = underlineMarks(buildReviewItems(text, [issue(text, "preico", ["precio"])]));
    expect(marks).toEqual([
      { start: 0, end: 3, tone: "safe" },
      { start: 7, end: 13, tone: "doubt" },
    ]);
  });

  it("no se superponen", () => {
    const items = buildReviewItems("tienen stock?", []);
    expect(underlineMarks([...items, ...items])).toHaveLength(1);
  });
});
