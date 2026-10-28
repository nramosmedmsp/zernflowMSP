// Corrector en segundo plano (Web Worker): carga el diccionario de español de
// Perú (Hunspell, el de LibreOffice) una sola vez y revisa palabras sin
// trabar la página. Mensajes: "words" (palabras de la tienda) y "check".

import nspell from "nspell";
import { normalizeWord, rankSuggestions } from "@/lib/spell-check";

type Request =
  | { type: "words"; words: string[] }
  | { type: "check"; id: number; words: string[] };

type Speller = ReturnType<typeof nspell>;

let speller: Promise<Speller> | null = null;
const extra = new Set<string>();
const cache = new Map<string, string[] | null>();

function load(): Promise<Speller> {
  speller ??= Promise.all([
    fetch("/dictionaries/es-pe/es-pe.aff").then((r) => r.text()),
    fetch("/dictionaries/es-pe/es-pe.dic").then((r) => r.text()),
  ]).then(([aff, dic]) => {
    const s = nspell(aff, dic);
    for (const w of extra) s.add(w);
    return s;
  });
  return speller;
}

/** null si está bien escrita; si no, sus sugerencias (puede ser []). */
function check(s: Speller, word: string): string[] | null {
  const hit = cache.get(word);
  if (hit !== undefined) return hit;
  const ok = extra.has(normalizeWord(word)) || s.correct(word) || s.correct(normalizeWord(word));
  const result = ok ? null : rankSuggestions(word, (w) => s.correct(w), s.suggest(word));
  cache.set(word, result);
  return result;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (msg.type === "words") {
    const s = speller ? await speller : null;
    for (const w of msg.words) {
      const key = normalizeWord(w);
      if (extra.has(key)) continue;
      extra.add(key);
      s?.add(key);
    }
    cache.clear();
    return;
  }
  try {
    const s = await load();
    const results: Record<string, string[]> = {};
    for (const w of new Set(msg.words)) {
      const r = check(s, w);
      if (r) results[w] = r;
    }
    self.postMessage({ id: msg.id, ok: true, results });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
