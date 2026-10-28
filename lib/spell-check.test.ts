import { describe, expect, it } from "vitest";
import { reviewOutgoing } from "./send-review";
import {
  accentVariants,
  cleanSpellWord,
  editDistance,
  soundKey,
  isAccentOnly,
  mergeSpellIssues,
  rankSuggestions,
  replaceIssue,
  spellTokens,
} from "./spell-check";

const words = (text: string, known: string[] = []) => spellTokens(text, new Set(known)).map((t) => t.word);

describe("spellTokens", () => {
  it("revisa las palabras comunes y salta lo que no debe marcar", () => {
    expect(words("buenas holas, grasias por escribir")).toEqual(["buenas", "holas", "grasias", "por", "escribir"]);
    expect(words("mira https://muscleshop.pe/whey o escribe a ventas@muscleshop.pe")).toEqual(["mira", "escribe"]);
    expect(words("hola {nombre}, te escribe @Ana")).toEqual(["hola", "te", "escribe"]);
    expect(words("cuesta S/ 189 y 2lb x 5kg")).toEqual(["cuesta"]);
    expect(words("entra a muscleshop.pe. Listo")).toEqual(["entra", "Listo"]);
  });

  it("no marca siglas, nombres propios ni palabras de la tienda", () => {
    expect(words("Hola Patricia, el BCAA llega a Miraflores")).toEqual(["Hola", "el", "llega"]);
    expect(words("la whey isolate es buena", ["whey", "isolate"])).toEqual(["la", "es", "buena"]);
    expect(words("Whey en stock. Isolate también", ["whey", "isolate"])).toEqual(["en", "stock", "también"]);
  });
});

describe("sugerencias", () => {
  const dict = new Set(["mañana", "manada", "días", "dirección", "gracias", "grasas", "precio", "perico"]);
  const ok = (w: string) => dict.has(w);

  it("primero la que solo agrega tilde o ñ", () => {
    expect(accentVariants("dias")).toContain("días");
    expect(rankSuggestions("manana", ok, ["manada", "macana"])).toEqual(["mañana", "manada", "macana"]);
    expect(rankSuggestions("direccion", ok, [])).toEqual(["dirección"]);
    expect(rankSuggestions("preico", ok, ["perico", "precio", "predico", "otro"])).toEqual(["precio", "predico", "perico"]);
    expect(rankSuggestions("holas", ok, ["bolas", "hola", "colas"])).toEqual(["hola", "bolas", "colas"]);
    expect(rankSuggestions("grasias", ok, ["grasas", "gracias"])).toEqual(["gracias", "grasas"]);
    const withDe = (w: string) => ok(w) || ["de", "dé", "di"].includes(w);
    expect(rankSuggestions("dc", (w) => withDe(w) || w === "da", ["D", "Da", "De", "Dé", "Di", "DC"])[0]).toBe("de");
    expect(rankSuggestions("tanbien", ok, ["rancien", "cambien", "rabien", "también"])[0]).toBe("también");
  });

  it("respeta las mayúsculas de lo escrito", () => {
    expect(rankSuggestions("Grasias", ok, ["gracias"])).toEqual(["Gracias"]);
  });

  it("solo cambiar tildes es seguro", () => {
    expect(isAccentOnly("manana", "mañana")).toBe(true);
    expect(isAccentOnly("dc", "de")).toBe(false);
  });
});

describe("replaceIssue", () => {
  it("cambia la palabra en su lugar o la busca si el texto se movió", () => {
    expect(replaceIssue("hola grasias", { word: "grasias", start: 5, end: 12 }, "gracias")).toEqual({ text: "hola gracias", caret: 12 });
    expect(replaceIssue("ok, hola grasias", { word: "grasias", start: 5, end: 12 }, "gracias")?.text).toBe("ok, hola gracias");
    expect(replaceIssue("hola", { word: "grasias", start: 5, end: 12 }, "gracias")).toBeNull();
  });
});

describe("mergeSpellIssues", () => {
  it("suma las del diccionario sin repetir las de la lista fija", () => {
    const text = "asi es, grasias. el preico x dc";
    const merged = mergeSpellIssues(reviewOutgoing(text), [
      { word: "asi", start: 0, end: 3, suggestions: ["así"] },
      { word: "grasias", start: 8, end: 15, suggestions: ["gracias"] },
      { word: "preico", start: 20, end: 26, suggestions: ["precio"] },
      { word: "dc", start: 29, end: 31, suggestions: ["de"] },
      { word: "zzz", start: 0, end: 0, suggestions: [] },
    ]);
    expect(merged.suggestions.map((s) => `${s.from}→${s.to}:${s.source}${s.unsure ? "?" : ""}`)).toEqual([
      "asi→así:lista",
      "grasias→gracias:diccionario",
      "preico→precio:diccionario?",
      "dc→de:diccionario?",
    ]);
  });

  it("si solo cambian tildes, va marcada", () => {
    const merged = mergeSpellIssues(reviewOutgoing("llega manana"), [{ word: "manana", start: 6, end: 12, suggestions: ["mañana"] }]);
    expect(merged.suggestions[0]).toMatchObject({ to: "mañana", unsure: false });
  });
});

describe("cleanSpellWord", () => {
  it("una sola palabra con letras", () => {
    expect(cleanSpellWord("  Optimum ")).toEqual({ ok: true, word: "Optimum" });
    expect(cleanSpellWord("pre-workout")).toEqual({ ok: true, word: "pre-workout" });
    expect(cleanSpellWord("dos palabras").ok).toBe(false);
    expect(cleanSpellWord("100g").ok).toBe(false);
    expect(cleanSpellWord("").ok).toBe(false);
  });
});

describe("editDistance", () => {
  it("cuenta el intercambio de letras vecinas como un solo error", () => {
    expect(editDistance("preico", "precio")).toBe(1);
    expect(editDistance("holas", "hola")).toBe(1);
    expect(editDistance("casa", "casa")).toBe(0);
  });
});

describe("soundKey", () => {
  it("s, c y z; b y v; ll e y; la h muda", () => {
    expect(soundKey("grasias")).toBe(soundKey("gracias"));
    expect(soundKey("holas")).not.toBe(soundKey("olas"));
    expect(soundKey("bale")).toBe(soundKey("vale"));
    expect(soundKey("yamar")).toBe(soundKey("llamar"));
    expect(soundKey("casa")).not.toBe(soundKey("caza") + "x");
  });
});
