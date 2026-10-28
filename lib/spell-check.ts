// Corrector en español de la Bandeja: qué palabras revisar, cómo ordenar las
// sugerencias del diccionario (Hunspell es-PE, corre en un worker del navegador)
// y cuáles son seguras. Solo lógica pura, para probarla.

import { inside, maskedRanges, matchCase } from "@/lib/send-review";

export interface SpellToken {
  word: string;
  start: number;
  end: number;
}

export interface SpellIssue extends SpellToken {
  /** Hasta 3 sugerencias, la más probable primero (puede venir vacía). */
  suggestions: string[];
}

/** Palabras: solo letras (los números, enlaces y correos no se revisan). */
const TOKEN_RE = /\p{L}+/gu;
/** Pegada a uno de estos, la palabra es parte de un código, usuario o enlace. */
const GLUED_RE = /[\p{N}_@/#&=]/u;

/** "muscleshop.pe": un punto entre letras es un dominio, no el fin de la frase. */
function dotted(text: string, start: number, end: number): boolean {
  return (text[end] === "." && /\p{L}/u.test(text[end + 1] ?? "")) || (text[start - 1] === "." && /\p{L}/u.test(text[start - 2] ?? ""));
}

export function normalizeWord(word: string): string {
  return word.normalize("NFC").toLowerCase();
}

/** Sin tildes ni ñ: "Dirección" → "direccion". */
export function stripAccents(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/** ¿La palabra abre una frase? (al inicio, o después de . ! ? o un salto de línea). */
function startsSentence(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const ch = text[i];
    if (/\s|[¿¡"'«(]/u.test(ch)) continue;
    return /[.!?\n…]/u.test(ch);
  }
  return true;
}

/**
 * Palabras a revisar con el diccionario. Se saltan las que el corrector no
 * debe marcar: enlaces, correos, @menciones y {variables}; las que tienen
 * números o símbolos pegados; las de una letra; las siglas en mayúsculas
 * (BCAA, OK); los nombres propios (mayúscula en medio de la frase) y las del
 * diccionario de la tienda.
 */
export function spellTokens(text: string, known: ReadonlySet<string>): SpellToken[] {
  const masked = maskedRanges(text);
  const out: SpellToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const word = m[0];
    const start = m.index ?? 0;
    const end = start + word.length;
    if (word.length < 2 || inside(masked, start)) continue;
    if (GLUED_RE.test(text[start - 1] ?? "") || GLUED_RE.test(text[end] ?? "") || dotted(text, start, end)) continue;
    if (word === word.toUpperCase()) continue;
    if (isUpper(word[0]) && !startsSentence(text, start)) continue;
    if (known.has(normalizeWord(word))) continue;
    out.push({ word, start, end });
  }
  return out;
}

const ACCENTED: Readonly<Record<string, string>> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" };

/** La palabra con una tilde (o ñ) más: "manana" → "mañana", "dias" → "días". */
export function accentVariants(word: string): string[] {
  const lower = normalizeWord(word);
  const out: string[] = [];
  for (let i = 0; i < lower.length; i++) {
    const swap = ACCENTED[lower[i]];
    if (swap) out.push(lower.slice(0, i) + swap + lower.slice(i + 1));
  }
  return out;
}

/** Distancia de edición con intercambio de letras vecinas ("preico" → "precio" = 1). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Cómo suena la palabra en el español de Perú: s, c (ante e, i) y z suenan
 * igual; también b y v, ll e y, g (ante e, i) y j; qu y c (ante a, o, u) son
 * k. "grasias" y "gracias" suenan igual. La h se deja: si no, "holas" sonaría
 * como "olas" y le ganaría a "hola".
 */
export function soundKey(word: string): string {
  return stripAccents(normalizeWord(word))
    .replace(/qu/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/ll/g, "y")
    .replace(/g(?=[ei])/g, "j")
    .replace(/(.)\1+/g, "$1");
}

/** Palabras muy usadas (y las de la tienda): a igual parecido, se sugieren primero ("dc" → "de"). */
const COMMON = new Set(
  (
    "de la que el en y a los se del las un por con no una su para es al lo como más o pero sus le me si sin " +
    "este ya cuando todo esta ser son dos también fue muy hasta desde está mi porque qué solo yo hay vez " +
    "puede todos así nos ni tiene bien donde ahora cada te otro después tan siempre día tanto sí menos antes " +
    "hola gracias buenas buenos días tardes noches precio precios envío envíos pedido pedidos stock talla " +
    "sabor sabores proteína proteínas creatina pago pagos tienda dirección número cuenta mañana hoy tienes " +
    "tenemos quieres puedes claro listo perfecto favor ayuda llega llegó compra comprar producto productos"
  ).split(" "),
);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Ordena las sugerencias: primero las que solo agregan una tilde o una ñ (el
 * error más común en el chat); después las que suenan igual ("grasias" →
 * "gracias"); luego las del diccionario, de la más parecida a la menos; a
 * igual parecido, las palabras muy usadas y la que comparte más letras al comienzo
 * ("holas" → "hola" antes que "bolas"; "preico" → "precio" antes que
 * "perico"). Respeta las mayúsculas de lo escrito y deja como máximo `max`.
 */
export function rankSuggestions(word: string, isCorrect: (w: string) => boolean, raw: readonly string[], max = 3): string[] {
  const base = stripAccents(normalizeWord(word));
  const seen = new Set<string>([normalizeWord(word)]);
  const out: string[] = [];
  const push = (candidate: string) => {
    const key = normalizeWord(candidate);
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(matchCase(word, candidate));
  };
  for (const v of accentVariants(word)) if (isCorrect(v)) push(v);
  const sound = soundKey(word);
  const lowerWord = word === word.toLowerCase();
  // Para una palabra en minúsculas no sirven las letras sueltas, las siglas ni
  // los nombres propios ("dc" → "D", "Da"): "De" se sugiere como "de".
  const useful = raw
    .map((c) => (lowerWord && c !== c.toLowerCase() && isCorrect(c.toLowerCase()) ? c.toLowerCase() : c))
    .filter((c) => c.length > 1 && !(lowerWord && c !== c.toLowerCase()));
  const scored = useful.map((candidate, index) => {
    const plain = stripAccents(normalizeWord(candidate));
    return {
      candidate,
      index,
      sameSound: soundKey(candidate) === sound ? 0 : 1,
      distance: editDistance(base, plain),
      common: COMMON.has(normalizeWord(candidate)) ? 0 : 1,
      prefix: commonPrefix(base, plain),
    };
  });
  scored.sort(
    (a, b) => a.sameSound - b.sameSound || a.distance - b.distance || a.common - b.common || b.prefix - a.prefix || a.index - b.index,
  );
  for (const s of scored) push(s.candidate);
  return out;
}

/** ¿La sugerencia solo cambia tildes o la ñ? */
export function isAccentOnly(word: string, suggestion: string): boolean {
  const a = normalizeWord(word);
  const b = normalizeWord(suggestion);
  return a !== b && stripAccents(a) === stripAccents(b);
}

/** Segura: solo cambia tildes, o suena igual ("grasias" → "gracias"). */
export function isSafeFix(word: string, suggestion: string): boolean {
  return isAccentOnly(word, suggestion) || (normalizeWord(word) !== normalizeWord(suggestion) && soundKey(word) === soundKey(suggestion));
}

/**
 * Cambia una palabra marcada por otra. Si el texto cambió desde la revisión,
 * la busca de nuevo (la misma palabra entera más cercana); null si ya no está.
 */
export function replaceIssue(text: string, issue: SpellToken, replacement: string): { text: string; caret: number } | null {
  const apply = (start: number, end: number) => ({
    text: text.slice(0, start) + replacement + text.slice(end),
    caret: start + replacement.length,
  });
  if (text.slice(issue.start, issue.end) === issue.word) return apply(issue.start, issue.end);
  let best: SpellToken | null = null;
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[0] !== issue.word) continue;
    const start = m.index ?? 0;
    if (!best || Math.abs(start - issue.start) < Math.abs(best.start - issue.start)) {
      best = { word: m[0], start, end: start + m[0].length };
    }
  }
  return best ? apply(best.start, best.end) : null;
}

const WORD_MAX = 60;

/** Palabra para el diccionario de la tienda: una sola, con letras, guion o apóstrofo. */
export function cleanSpellWord(raw: string): { ok: true; word: string } | { ok: false; error: string } {
  const word = (raw ?? "").trim();
  if (!word) return { ok: false, error: "Escribe una palabra." };
  if (word.length > WORD_MAX) return { ok: false, error: `La palabra puede tener hasta ${WORD_MAX} letras.` };
  if (!/^\p{L}[\p{L}'’-]*$/u.test(word)) return { ok: false, error: "Escribe una sola palabra, sin espacios ni números." };
  return { ok: true, word };
}
