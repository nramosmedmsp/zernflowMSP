// Cosas por revisar de un mensaje, en una sola lista: las correcciones de la
// lista fija y de las preguntas (lib/send-review.ts), las palabras que marcó el
// diccionario (lib/spell-check.ts) y las llaves {variable} sin reemplazar. Se
// calcula en vivo del texto de la caja; la caja subraya lo mismo que la franja.
// Solo lógica pura, para probarla.

import { PLACEHOLDER_RE } from "@/lib/saved-replies";
import { reviewOutgoing, type Suggestion } from "@/lib/send-review";
import { isSafeFix, normalizeWord, type SpellIssue } from "@/lib/spell-check";

export type ReviewSource = "lista" | "pregunta" | "signo" | "diccionario" | "llave";

export interface TextRange {
  start: number;
  end: number;
}

/** Un cambio al texto: reemplaza [start, end) (start === end: inserta). */
export interface ReviewEdit extends TextRange {
  to: string;
}

export interface ReviewItem extends TextRange {
  /** Estable mientras el texto no cambie (sirve de key en la lista). */
  id: string;
  /** Para ignorarlo en este mensaje: la palabra normalizada, o "signo:…" / "pregunta:…". */
  key: string;
  /** El texto que se cambia (en un signo o una pregunta, la frase entera). */
  from: string;
  /** Cómo queda; null si no hay corrección posible (solo ignorar o editar a mano). */
  to: string | null;
  /** Segura: lista fija, pregunta, signo o diccionario que solo cambia tildes o suena igual. */
  safe: boolean;
  source: ReviewSource;
  /** Otras sugerencias del diccionario, además de `to`. */
  others: string[];
  /** Lo que se subraya en la caja. */
  underline: TextRange;
  /** Los cambios que hace aplicarlo. */
  edits: ReviewEdit[];
}

export interface AppliedItems {
  text: string;
  /** Lo recién cambiado, en el texto nuevo (para resaltarlo un momento). */
  changed: TextRange[];
  caret: number;
}

const NO_IGNORED: ReadonlySet<string> = new Set();
const LETTERS_RE = /\p{L}+/gu;
const FIRST_WORD_RE = /^[\p{L}\p{N}]+/u;

/**
 * Las palabras del diccionario, ya con su posición en el texto de ahora: si el
 * texto cambió desde la revisión busca la misma palabra entera más cercana, y
 * si ya no está la descarta.
 */
function anchoredIssues(text: string, issues: readonly SpellIssue[]): SpellIssue[] {
  const used = new Set<number>();
  const out: SpellIssue[] = [];
  for (const issue of [...issues].sort((a, b) => a.start - b.start)) {
    let start = issue.start;
    if (text.slice(issue.start, issue.end) !== issue.word || used.has(issue.start)) {
      let best = -1;
      for (const m of text.matchAll(LETTERS_RE)) {
        const at = m.index ?? 0;
        if (m[0] !== issue.word || used.has(at)) continue;
        if (best < 0 || Math.abs(at - issue.start) < Math.abs(best - issue.start)) best = at;
      }
      if (best < 0) continue;
      start = best;
    }
    used.add(start);
    out.push({ ...issue, start, end: start + issue.word.length });
  }
  return out;
}

/** Cambia varios tramos de un texto a la vez; lo que se superpone con uno anterior se salta. */
function applyEditList(text: string, edits: ReadonlyArray<ReviewEdit & { owner: number }>) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  const ranges: Array<TextRange & { owner: number }> = [];
  for (const e of sorted) {
    if (e.start < cursor) continue;
    out += text.slice(cursor, e.start);
    const start = out.length;
    out += e.to;
    ranges.push({ start, end: out.length, owner: e.owner });
    cursor = e.end;
  }
  return { text: out + text.slice(cursor), ranges };
}

/** Primera palabra del tramo (lo que se subraya cuando solo falta un signo). */
function firstWordRange(text: string, start: number, end: number): TextRange {
  const word = FIRST_WORD_RE.exec(text.slice(start, end))?.[0];
  return { start, end: word ? start + word.length : Math.min(start + 1, end) };
}

/**
 * Pregunta completa en un solo ítem cuando falta el signo y además hay tildes de
 * pregunta en la misma frase: "como estas?" → "¿cómo estás?".
 */
function questionItems(text: string, suggestions: Suggestion[]): { items: Omit<ReviewItem, "id">[]; rest: Suggestion[] } {
  const marks = suggestions.filter((s) => s.kind === "mark");
  const taken = new Set<Suggestion>();
  const items: Omit<ReviewItem, "id">[] = [];
  for (const mark of marks) {
    const start = mark.start;
    const end = start + (mark.preview?.before.length ?? 0);
    const words = suggestions.filter((s) => s.kind === "word" && s.source === "pregunta" && s.start >= start && s.end <= end);
    const from = text.slice(start, end);
    const edits: ReviewEdit[] = [{ start, end: start, to: mark.to }, ...words.map((w) => ({ start: w.start, end: w.end, to: w.to }))];
    const to = applyEditList(from, edits.map((e) => ({ start: e.start - start, end: e.end - start, to: e.to, owner: 0 }))).text;
    const wordsEnd = Math.max(start, ...words.map((w) => w.end));
    items.push({
      key: `${words.length > 0 ? "pregunta" : "signo"}:${normalizeWord(from)}`,
      start,
      end,
      from,
      to,
      safe: true,
      source: words.length > 0 ? "pregunta" : "signo",
      others: [],
      underline: wordsEnd > start ? { start, end: wordsEnd } : firstWordRange(text, start, end),
      edits,
    });
    taken.add(mark);
    for (const w of words) taken.add(w);
  }
  return { items, rest: suggestions.filter((s) => !taken.has(s)) };
}

/**
 * Todo lo que hay por revisar en `text`, en orden. `ignored` son las claves
 * (`key`) que el asesor descartó en este mensaje. Si la lista fija y el
 * diccionario marcan la misma palabra, gana la lista fija.
 */
export function buildReviewItems(text: string, issues: readonly SpellIssue[], ignored: ReadonlySet<string> = NO_IGNORED): ReviewItem[] {
  const drafts: Omit<ReviewItem, "id">[] = [];

  const { items: questions, rest } = questionItems(text, reviewOutgoing(text).suggestions);
  drafts.push(...questions);
  for (const s of rest) {
    drafts.push({
      key: normalizeWord(s.from),
      start: s.start,
      end: s.end,
      from: s.from,
      to: s.to,
      safe: true,
      source: s.source === "pregunta" ? "pregunta" : "lista",
      others: [],
      underline: { start: s.start, end: s.end },
      edits: [{ start: s.start, end: s.end, to: s.to }],
    });
  }

  // Diccionario: lo que ya corrigió la lista fija o una pregunta no se repite.
  const fixed = drafts.flatMap((d) => d.edits).filter((e) => e.end > e.start);
  for (const issue of anchoredIssues(text, issues)) {
    if (fixed.some((e) => issue.start < e.end && e.start < issue.end)) continue;
    const [to = null, ...others] = issue.suggestions;
    drafts.push({
      key: normalizeWord(issue.word),
      start: issue.start,
      end: issue.end,
      from: issue.word,
      to,
      safe: to !== null && isSafeFix(issue.word, to),
      source: "diccionario",
      others,
      underline: { start: issue.start, end: issue.end },
      edits: to === null ? [] : [{ start: issue.start, end: issue.end, to }],
    });
  }

  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    drafts.push({
      key: normalizeWord(m[0]),
      start,
      end: start + m[0].length,
      from: m[0],
      to: null,
      safe: false,
      source: "llave",
      others: [],
      underline: { start, end: start + m[0].length },
      edits: [],
    });
  }

  const seen = new Map<string, number>();
  return drafts
    .filter((d) => !ignored.has(d.key))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((d) => {
      const base = `${d.source}:${d.key}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { ...d, id: `${base}#${n}` };
    });
}

/** Las que se pueden corregir sin dudar: tienen corrección y es segura. */
export function safeReviewItems(items: readonly ReviewItem[]): ReviewItem[] {
  return items.filter((i) => i.safe && i.to !== null);
}

/** Aplica varios ítems de una vez (los cambios no se pisan entre sí). */
export function applyReviewItems(text: string, items: readonly ReviewItem[], choice?: string): AppliedItems {
  // `choice`: otra sugerencia del diccionario para un solo ítem.
  const edits = items.flatMap((item, owner) =>
    item.edits.map((e) => ({ ...e, to: choice !== undefined && item.edits.length === 1 ? choice : e.to, owner })),
  );
  const { text: next, ranges } = applyEditList(text, edits);
  // Un tramo por ítem: de su primer cambio al último.
  const changed = items.flatMap((_, owner) => {
    const mine = ranges.filter((r) => r.owner === owner);
    return mine.length === 0 ? [] : [{ start: Math.min(...mine.map((r) => r.start)), end: Math.max(...mine.map((r) => r.end)) }];
  });
  const caret = items.length === 1 && changed[0] ? changed[0].end : next.length;
  return { text: next, changed, caret };
}

/** Aplica un ítem; `choice` es otra sugerencia del diccionario en lugar de la primera. */
export function applyReviewItem(text: string, item: ReviewItem, choice?: string): AppliedItems {
  return applyReviewItems(text, [item], choice);
}

export interface UnderlineMark extends TextRange {
  tone: "safe" | "doubt";
}

/** Subrayados de la caja: rojo para lo seguro, ámbar para lo dudoso. Sin superponerse. */
export function underlineMarks(items: readonly ReviewItem[]): UnderlineMark[] {
  const marks: UnderlineMark[] = [];
  let last = 0;
  for (const item of [...items].sort((a, b) => a.underline.start - b.underline.start)) {
    const { start, end } = item.underline;
    if (end <= start || start < last) continue;
    marks.push({ start, end, tone: item.safe ? "safe" : "doubt" });
    last = end;
  }
  return marks;
}
