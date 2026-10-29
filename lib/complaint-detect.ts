// Detector de reclamos en el texto de un mensaje entrante (control de
// reclamos, docs/PLAN-CRM.md 3 y 7). Puro y barato: se evalúa en cada mensaje
// del cliente. Compara sin tildes ni mayúsculas y por palabras completas
// ("roto" no coincide con "rotonda").

/** Frases (y palabras) que hacen pensar que el cliente tiene un reclamo. */
export const COMPLAINT_PHRASES: readonly string[] = [
  "reclamo",
  "queja",
  "quejarme",
  "llegó roto",
  "llegó rota",
  "llegó dañado",
  "llegó dañada",
  "llegó abierto",
  "llegó vencido",
  "llegaron rotos",
  "llegaron rotas",
  "llegaron dañados",
  "llegaron dañadas",
  "roto",
  "rota",
  "dañado",
  "dañada",
  "malogrado",
  "defectuoso",
  "vencido",
  "venció",
  "no llegó",
  "no me llegó",
  "nunca llegó",
  "devolución",
  // "devolver" suelto también aparece en «¿me puedes devolver la llamada?»:
  // solo cuenta cuando se habla de devolver el producto o el dinero.
  "quiero devolver",
  "quiero devolverlo",
  "quiero devolverla",
  "devolver el producto",
  "devolver mi producto",
  "devolver el pedido",
  "devolver mi pedido",
  "devolver el dinero",
  "devolver mi dinero",
  "devolverlo",
  "devolverla",
  "me devuelvan",
  "me devuelvas",
  "reembolso",
  "me estafaron",
  "estafa",
  "fraude",
  "falsificado",
  "no es original",
  "mal estado",
  "incompleto",
];

export interface ComplaintMatch {
  /** Lo que escribió el cliente, tal cual (por ejemplo «llegó roto»). */
  excerpt: string;
  /** La frase de la lista que coincidió. */
  phrase: string;
}

/** Minúsculas y sin tildes (la ñ cuenta como n), con el índice original de cada letra. */
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const ch of text) {
    const plain = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const c of plain) {
      folded += c;
      origin.push(index);
    }
    index += ch.length;
  }
  return { folded, origin };
}

function foldPhrase(phrase: string): string {
  return fold(phrase).folded;
}

/**
 * Frases que describen el estado del producto: «no está roto» o «sin daños»
 * dicen lo contrario de un reclamo, así que no cuentan si hay una negación
 * justo antes.
 */
const NEGATABLE = new Set([
  "llegó roto",
  "llegó rota",
  "llegó dañado",
  "llegó dañada",
  "llegó abierto",
  "llegó vencido",
  "llegaron rotos",
  "llegaron rotas",
  "llegaron dañados",
  "llegaron dañadas",
  "roto",
  "rota",
  "dañado",
  "dañada",
  "malogrado",
  "defectuoso",
  "vencido",
  "venció",
  "mal estado",
  "incompleto",
]);

/** «no llegó roto» no es «no llegó»: el pedido sí llegó. */
const NOT_ARRIVED_EXCEPT = "(?!\\s+(?:roto|rota|rotos|rotas|danado|danada|danados|danadas|abierto|vencido)(?![a-z0-9]))";
const NEGATION = /(?<![a-z0-9])(?:no|ni|nada|sin|jamas|nunca)(?![a-z0-9])/;

const PATTERNS = COMPLAINT_PHRASES.map((phrase) => {
  const folded = foldPhrase(phrase);
  const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const except = folded === "no llego" || folded === "nunca llego" ? NOT_ARRIVED_EXCEPT : "";
  return {
    phrase,
    negatable: NEGATABLE.has(phrase),
    regex: new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])${except}`, "g"),
  };
});

/** ¿Hay una negación en las tres palabras anteriores, dentro de la misma oración? */
function negatedBefore(folded: string, index: number): boolean {
  const clause = folded.slice(0, index).split(/[.,;:!?¿¡\n]/).pop() ?? "";
  const words = clause.split(/[^a-z0-9]+/).filter(Boolean).slice(-3);
  return words.some((w) => NEGATION.test(w));
}

/** Primera coincidencia de la frase que no esté negada. */
function firstMatch(pattern: (typeof PATTERNS)[number], folded: string): RegExpExecArray | null {
  pattern.regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.regex.exec(folded)) !== null) {
    if (!pattern.negatable || !negatedBefore(folded, m.index)) return m;
    if (m[0] === "") pattern.regex.lastIndex++;
  }
  return null;
}

/**
 * Busca una frase de reclamo en el texto. Devuelve la primera que aparece en
 * el mensaje (la más larga si varias empiezan en el mismo lugar), o null.
 */
export function detectComplaint(text: string | null | undefined): ComplaintMatch | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const { folded, origin } = fold(text);
  let best: { start: number; end: number; phrase: string } | null = null;
  for (const pattern of PATTERNS) {
    const phrase = pattern.phrase;
    const m = firstMatch(pattern, folded);
    if (!m) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    if (!best || start < best.start || (start === best.start && end > best.end)) {
      best = { start, end, phrase };
    }
  }
  if (!best) return null;
  const from = origin[best.start];
  const last = origin[best.end - 1];
  // Incluye la letra completa (puede ocupar más de una unidad en el texto original).
  const to = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
  return { excerpt: text.slice(from, to).replace(/\s+/g, " ").trim(), phrase: best.phrase };
}
