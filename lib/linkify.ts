// Parte un texto en trozos de texto y enlaces para mostrarlos clicables en el
// chat. Solo http, https y www.; nunca otros esquemas (javascript:, data:).

export type TextPart = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?¡¿…'"»]+$/;

/** Quita la puntuación final y un ")" de cierre que no abre dentro del enlace. */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING, "");
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING, "");
  }
  return url;
}

export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (!url || url.toLowerCase() === "www.") continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parts.push({ type: "link", value: url, href });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
