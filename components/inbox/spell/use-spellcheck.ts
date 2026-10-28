"use client";

// Corrector de la caja de texto: manda las palabras al worker del diccionario
// (spell.worker.ts) un momento después de dejar de escribir y devuelve las mal
// escritas con sus sugerencias. El worker y el diccionario de la tienda se
// comparten entre los chats: se cargan una vez por pestaña.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeWord, spellTokens, type SpellIssue } from "@/lib/spell-check";
import { addOrRequestSpellWord } from "@/lib/actions/spell-words";

type Results = Record<string, string[]>;

interface SpellClient {
  check(words: string[]): Promise<Results>;
  addWords(words: string[]): void;
}

let client: SpellClient | null = null;

function spellClient(): SpellClient | null {
  if (client) return client;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    // Lo empaqueta scripts/build-spell-worker.mjs (Turbopack no empaqueta workers).
    worker = new Worker("/spell-worker.js");
  } catch {
    return null;
  }
  let seq = 0;
  const pending = new Map<number, (r: Results) => void>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; results?: Results; error?: string }>) => {
    const done = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (!e.data.ok) console.error("[corrector]", e.data.error);
    done?.(e.data.results ?? {});
  };
  client = {
    check(words) {
      if (words.length === 0) return Promise.resolve({});
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ type: "check", id, words });
      });
    },
    addWords(words) {
      if (words.length > 0) worker.postMessage({ type: "words", words });
    },
  };
  return client;
}

// ── Diccionario de la tienda (spell_words) ──────────────────────────────────

const storeWords = new Map<string, Promise<Set<string>>>();
const listeners = new Set<() => void>();

function loadStoreWords(workspaceId: string): Promise<Set<string>> {
  let loaded = storeWords.get(workspaceId);
  if (!loaded) {
    loaded = Promise.resolve(
      createClient()
        .from("spell_words")
        .select("normalized")
        .eq("workspace_id", workspaceId)
        // Los pedidos sin aprobar todavía se marcan como error.
        .eq("status", "approved")
        .then(({ data, error }) => {
          if (error) console.error("[corrector] diccionario de la tienda:", error.message);
          const set = new Set((data ?? []).map((r) => r.normalized));
          spellClient()?.addWords([...set]);
          return set;
        }),
    );
    storeWords.set(workspaceId, loaded);
  }
  return loaded;
}

/**
 * Agrega la palabra al diccionario de la tienda (administradores) o deja el
 * pedido para que un administrador la apruebe (los demás).
 */
export async function addOrRequestStoreWord(
  workspaceId: string,
  word: string,
): Promise<{ status: "approved" | "pending" } | { error: string }> {
  const result = await addOrRequestSpellWord(word);
  if ("error" in result) return result;
  if (result.status === "approved") {
    const normalized = normalizeWord(result.word.word);
    (await loadStoreWords(workspaceId)).add(normalized);
    spellClient()?.addWords([normalized]);
    listeners.forEach((fn) => fn());
  }
  return { status: result.status };
}

// ── Hook ────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 400;

export function useSpellcheck({
  text,
  enabled,
  workspaceId,
  ignored,
}: {
  text: string;
  enabled: boolean;
  workspaceId: string;
  /** Palabras ignoradas en este mensaje (normalizadas). */
  ignored: ReadonlySet<string>;
}) {
  const [known, setKnown] = useState<Set<string> | null>(null);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ text: string; issues: SpellIssue[] }>({ text: "", issues: [] });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadStoreWords(workspaceId).then((set) => alive && setKnown(set));
    const onChange = () => setVersion((v) => v + 1);
    listeners.add(onChange);
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, [enabled, workspaceId]);

  const skip = useMemo(() => {
    const all = new Set(known ?? []);
    for (const w of ignored) all.add(w);
    return all;
    // version: una palabra nueva en el diccionario de la tienda vuelve a revisar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, ignored, version]);

  const run = useCallback(
    async (value: string): Promise<SpellIssue[]> => {
      const spell = spellClient();
      if (!spell) return [];
      const tokens = spellTokens(value, skip);
      const results = await spell.check(tokens.map((t) => t.word));
      return tokens.filter((t) => results[t.word]).map((t) => ({ ...t, suggestions: results[t.word] }));
    },
    [skip],
  );

  const latest = useRef(0);
  useEffect(() => {
    if (!enabled || !known) return;
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      void run(text).then((issues) => {
        if (mine === latest.current) setResult({ text, issues });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, enabled, known, run]);

  /** Revisión inmediata (al enviar): espera como máximo `timeoutMs`. */
  const checkNow = useCallback(
    async (value: string, timeoutMs = 1500): Promise<SpellIssue[]> => {
      if (!enabled) return [];
      if (result.text === value) return result.issues;
      const timeout = new Promise<SpellIssue[]>((resolve) => setTimeout(() => resolve([]), timeoutMs));
      return Promise.race([run(value), timeout]);
    },
    [enabled, result, run],
  );

  // Lo revisado corresponde al texto de ahora (si no, se muestra lo anterior hasta revisar de nuevo).
  const issues = enabled ? result.issues.filter((i) => !skip.has(normalizeWord(i.word)) && text.includes(i.word)) : [];
  return { issues, checkNow, ready: !!known };
}
