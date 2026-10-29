// Revisión al enviar (corrector gratuito, docs/PLAN-BANDEJA-CHAT.md §4): busca
// tildes seguras, abreviaturas, signos ¿ ¡ de apertura y llaves sin reemplazar
// en un mensaje al cliente. Nunca cambia nada solo: devuelve sugerencias que el
// asesor acepta o descarta.

import { ABBREVIATIONS, ALWAYS_ACCENTED, ENVIO_AFTER, GREETING_STARTS } from "@/lib/spanish-fixes";
import { findUnresolvedPlaceholders } from "@/lib/saved-replies";

export interface Suggestion {
  id: string;
  /** Rango del texto original que se reemplaza (start === end: se inserta). */
  start: number;
  end: number;
  from: string;
  to: string;
  kind: "word" | "mark";
  /** De dónde sale: la lista fija, el diccionario o la regla de las preguntas. */
  source?: "lista" | "diccionario" | "pregunta";
  /** El diccionario no está seguro: la casilla empieza sin marcar. */
  unsure?: boolean;
  /** Para los signos: la frase antes y después, para mostrarla. */
  preview?: { before: string; after: string };
}

export interface ReviewResult {
  suggestions: Suggestion[];
  /** "{nombre}", "{precio}"…: el cliente las vería tal cual. */
  unresolved: string[];
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
// Lo que no se revisa: enlaces, correos, @menciones y {variables}.
export const MASK_RE = /\b(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|@[\p{L}\p{N}_.]+|\{[^}\s]*\}/giu;

export function maskedRanges(text: string): Array<[number, number]> {
  return [...text.matchAll(MASK_RE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

export function inside(ranges: Array<[number, number]>, pos: number): boolean {
  return ranges.some(([a, b]) => pos >= a && pos < b);
}

/** Copia las mayúsculas del original: "Asi" → "Así", "ASI" → "ASÍ". */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

interface Sentence {
  start: number;
  end: number;
  closing: "?" | "!" | null;
}

/** Frases: terminan en . ! ? o salto de línea. */
function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]*(?:[.!?]+|\n|$)/g;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    const start = m.index ?? 0;
    const trimmed = m[0].replace(/\s+$/, "");
    const last = trimmed[trimmed.length - 1];
    out.push({ start, end: start + m[0].length, closing: last === "?" ? "?" : last === "!" ? "!" : null });
  }
  return out;
}

function sentenceOf(list: Sentence[], pos: number): Sentence | undefined {
  return list.find((s) => pos >= s.start && pos < s.end);
}

/** Primera palabra de la frase (en minúsculas). */
function firstWordStart(text: string, sentence: Sentence): number {
  const slice = text.slice(sentence.start, sentence.end);
  const m = /[\p{L}\p{N}]/u.exec(slice);
  return m ? sentence.start + m.index : sentence.start;
}

/** Palabras que llevan tilde cuando abren una pregunta: "¿cómo…?", "¿cuánto…?". */
const QUESTION_WORDS: Readonly<Record<string, string>> = {
  como: "cómo",
  cuanto: "cuánto",
  cuanta: "cuánta",
  cuantos: "cuántos",
  cuantas: "cuántas",
  donde: "dónde",
  cuando: "cuándo",
  que: "qué",
  quien: "quién",
  quienes: "quiénes",
  cual: "cuál",
  cuales: "cuáles",
};

/** Lo que suele seguir a "cómo / cuándo / dónde / qué…" en una pregunta corta de verdad. */
const QUESTION_CONTINUATIONS: ReadonlySet<string> = new Set([
  "estas", "estás", "esta", "está", "estan", "están", "es", "son", "fue", "fueron", "sale", "salen", "cuesta", "cuestan",
  "llega", "llegan", "tiene", "tienen", "hay", "puedo", "puedes", "puede", "pueden", "podemos", "podria", "podría", "seria",
  "sería", "queda", "quedan", "viene", "vienen", "va", "van", "tal", "hora", "precio", "costo", "se", "te", "lo", "la", "me",
]);

/** Siempre preguntas cuando la frase termina en "?": no son conjunciones. */
const NEVER_CONJUNCTION = new Set(["cuanto", "cuanta", "cuantos", "cuantas", "cuánto", "cuánta", "cuántos", "cuántas"]);

/**
 * ¿Es claramente una pregunta que abre con esa palabra? "Cuando puedas me
 * confirmas?" no: ahí "cuando" es una conjunción y poner tilde o ¿ al inicio la
 * dejaría mal. Con una palabra interrogativa ambigua (cuando, como, donde,
 * que…) solo es segura si la frase es muy corta o sigue un patrón conocido
 * ("¿cómo estás?", "¿qué hora es?"). Sin palabra interrogativa al inicio no
 * hay ambigüedad.
 */
function isClearQuestion(text: string, s: Sentence): boolean {
  const at = openingAt(text, s);
  const body = text.slice(at, s.end).replace(/[\s?!.]+$/, "");
  const words = body.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = (words[0] ?? "").toLowerCase();
  if (!(first in QUESTION_WORDS) && !Object.values(QUESTION_WORDS).includes(first)) return true;
  if (NEVER_CONJUNCTION.has(first)) return true;
  if (words.length <= 3) return true;
  const second = (words[1] ?? "").toLowerCase();
  return QUESTION_CONTINUATIONS.has(second) && words.length <= 6;
}

/**
 * Dónde empieza de verdad la frase: la primera palabra, o la que sigue a un
 * saludo con coma ("Hola Ana, como estas?" → "como").
 */
function openingAt(text: string, s: Sentence): number {
  const body = text.slice(s.start, s.end);
  const closeAt = s.start + body.replace(/\s+$/, "").length - 1;
  let at = firstWordStart(text, s);
  const firstWord = /^[\p{L}\p{N}]+/u.exec(text.slice(at))?.[0]?.toLowerCase() ?? "";
  const comma = body.indexOf(",");
  if (GREETING_STARTS.has(firstWord) && comma >= 0 && s.start + comma < closeAt) {
    const afterComma = /[^\s,]/u.exec(text.slice(s.start + comma + 1));
    if (afterComma) at = s.start + comma + 1 + afterComma.index;
  }
  return at;
}

/**
 * Tildes de las preguntas: la palabra que abre la pregunta ("como" → "cómo")
 * y lo que la sigue en el saludo de siempre ("cómo estas" → "cómo estás",
 * "por que" → "por qué"). Fuera de una pregunta no se toca nada.
 */
function questionFix(
  words: Array<{ value: string; start: number }>,
  i: number,
  opening: number | null,
): string | null {
  if (opening === null) return null;
  const w = words[i];
  const lower = w.value.toLowerCase();
  const prev = i > 0 ? words[i - 1] : null;
  const prevLower = prev?.value.toLowerCase() ?? "";
  if (w.start === opening) return QUESTION_WORDS[lower] ?? null;
  if (prev && prev.start === opening) {
    if (prevLower === "por" && lower === "que") return "qué";
    if ((prevLower === "como" || prevLower === "cómo") && (lower === "estas" || lower === "esta")) {
      return lower === "estas" ? "estás" : "está";
    }
  }
  return null;
}

function wordFixes(text: string, masked: Array<[number, number]>, list: Sentence[]): Suggestion[] {
  const words = [...text.matchAll(WORD_RE)].map((m) => ({ value: m[0], start: m.index ?? 0 }));
  const out: Suggestion[] = [];
  words.forEach((w, i) => {
    if (inside(masked, w.start)) return;
    const lower = w.value.toLowerCase();
    const prev = i > 0 ? words[i - 1].value.toLowerCase() : null;
    const sentence = sentenceOf(list, w.start);
    const question = sentence?.closing === "?";
    const firstOfSentence = sentence ? firstWordStart(text, sentence) === w.start : false;
    const opening = sentence && question ? openingAt(text, sentence) : null;
    let to: string | null = null;
    let source: Suggestion["source"] = "lista";

    if (ALWAYS_ACCENTED[lower]) to = ALWAYS_ACCENTED[lower];
    else if (lower === "envio") to = prev && ENVIO_AFTER.has(prev) ? "envío" : null;
    else if (lower === "q") to = question && firstOfSentence ? null : "que";
    else if (lower === "xq" || lower === "pq") to = question && firstOfSentence ? "por qué" : "porque";
    else if (ABBREVIATIONS[lower]) to = ABBREVIATIONS[lower];
    else if (lower.length > 4 && lower.endsWith("cion")) to = lower.slice(0, -4) + "ción";
    else if (lower.length > 4 && lower.endsWith("sion")) to = lower.slice(0, -4) + "sión";
    else {
      to = questionFix(words, i, opening);
      source = "pregunta";
    }

    if (!to) return;
    out.push({
      id: `w${w.start}`,
      start: w.start,
      end: w.start + w.value.length,
      from: w.value,
      to: matchCase(w.value, to),
      kind: "word",
      source,
      // Una frase que no es claramente una pregunta queda como "dudosa" (R2-B17).
      ...(source === "pregunta" && sentence && !isClearQuestion(text, sentence) ? { unsure: true } : {}),
    });
  });

  // "x favor" → "por favor".
  for (const m of text.matchAll(/\b[xX]\s+favor\b/g)) {
    const start = m.index ?? 0;
    if (inside(masked, start)) continue;
    out.push({
      id: `x${start}`,
      start,
      end: start + m[0].length,
      from: m[0],
      to: matchCase(m[0][0], "por") + m[0].slice(1),
      kind: "word",
      source: "lista",
    });
  }
  return out;
}

function markFixes(text: string, masked: Array<[number, number]>, list: Sentence[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of list) {
    if (!s.closing) continue;
    const opening = s.closing === "?" ? "¿" : "¡";
    const body = text.slice(s.start, s.end);
    if (body.includes(opening)) continue;
    // El signo de cierre dentro de un enlace (?utm=…) no cuenta.
    const closeAt = s.start + body.replace(/\s+$/, "").length - 1;
    if (inside(masked, closeAt)) continue;

    const at = openingAt(text, s);
    if (at >= closeAt) continue;
    const sentenceText = text.slice(at, closeAt + 1);
    out.push({
      id: `m${at}`,
      start: at,
      end: at,
      from: "",
      to: opening,
      kind: "mark",
      preview: { before: sentenceText, after: opening + sentenceText },
      ...(s.closing === "?" && !isClearQuestion(text, s) ? { unsure: true } : {}),
    });
  }
  return out;
}

export function reviewOutgoing(text: string): ReviewResult {
  const masked = maskedRanges(text);
  const list = sentences(text);
  const suggestions = [...wordFixes(text, masked, list), ...markFixes(text, masked, list)].sort((a, b) => a.start - b.start);
  return { suggestions, unresolved: findUnresolvedPlaceholders(text) };
}

/** Aplica las sugerencias elegidas (de atrás hacia adelante para no mover los índices). */
export function applySuggestions(text: string, chosen: Suggestion[]): string {
  let result = text;
  for (const s of [...chosen].sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, s.start) + s.to + result.slice(s.end);
  }
  return result;
}
