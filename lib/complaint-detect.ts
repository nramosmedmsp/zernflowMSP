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
  "devolver",
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

const PATTERNS = COMPLAINT_PHRASES.map((phrase) => {
  const escaped = foldPhrase(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return { phrase, regex: new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`) };
});

/**
 * Busca una frase de reclamo en el texto. Devuelve la primera que aparece en
 * el mensaje (la más larga si varias empiezan en el mismo lugar), o null.
 */
export function detectComplaint(text: string | null | undefined): ComplaintMatch | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const { folded, origin } = fold(text);
  let best: { start: number; end: number; phrase: string } | null = null;
  for (const { phrase, regex } of PATTERNS) {
    const m = regex.exec(folded);
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
