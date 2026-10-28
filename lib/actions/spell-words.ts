"use server";

// Diccionario de la tienda (corrector de la Bandeja, migración 00027). Con el
// cliente del usuario: la RLS decide quién ve (miembros), quién agrega
// (miembros) y quién quita (Dueño o Administrador).

import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { cleanSpellWord, normalizeWord } from "@/lib/spell-check";
import { readMemberNames } from "@/lib/flow-lab/scenarios/server";

export type SpellWordsResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface SpellWordView {
  id: string;
  word: string;
  /** Quién la agregó; null = lista inicial. */
  addedBy: string | null;
  createdAt: string;
}

export interface SpellWordsData {
  words: SpellWordView[];
  canRemove: boolean;
}

export async function listSpellWords(): Promise<SpellWordsResult<{ data: SpellWordsData }>> {
  try {
    const { supabase, workspace, role } = await getWorkspace();
    const { data, error } = await supabase
      .from("spell_words")
      .select("id, word, added_by, created_at")
      .eq("workspace_id", workspace.id)
      .order("word", { ascending: true });
    if (error) {
      console.error("[spell-words] list", error.message);
      return { error: "No se pudo cargar el diccionario de la tienda." };
    }
    const names = (data ?? []).some((r) => r.added_by) ? await readMemberNames(workspace.id) : {};
    return {
      ok: true,
      data: {
        canRemove: isAdminRole(role),
        words: (data ?? []).map((r) => ({
          id: r.id,
          word: r.word,
          addedBy: r.added_by ? (names[r.added_by] ?? "Otra persona") : null,
          createdAt: r.created_at,
        })),
      },
    };
  } catch (err) {
    console.error("[spell-words] list", err);
    return { error: "No se pudo cargar el diccionario de la tienda." };
  }
}

export async function addSpellWord(raw: string): Promise<SpellWordsResult<{ word: SpellWordView }>> {
  const checked = cleanSpellWord(raw);
  if (!checked.ok) return { error: checked.error };
  try {
    const { supabase, workspace, user } = await getWorkspace();
    const { data, error } = await supabase
      .from("spell_words")
      .insert({ workspace_id: workspace.id, word: checked.word, normalized: normalizeWord(checked.word), added_by: user.id })
      .select("id, word, created_at")
      .single();
    if (error?.code === "23505") return { error: "Esa palabra ya está en el diccionario." };
    if (error || !data) {
      console.error("[spell-words] add", error?.message);
      return { error: "No se pudo agregar la palabra. Inténtalo de nuevo." };
    }
    return { ok: true, word: { id: data.id, word: data.word, addedBy: "Tú", createdAt: data.created_at } };
  } catch (err) {
    console.error("[spell-words] add", err);
    return { error: "No se pudo agregar la palabra. Inténtalo de nuevo." };
  }
}

export async function removeSpellWord(id: string): Promise<SpellWordsResult> {
  try {
    const { supabase, workspace, role } = await getWorkspace();
    if (!isAdminRole(role)) return { error: "Solo el Dueño o un Administrador pueden quitar palabras." };
    const { data, error } = await supabase
      .from("spell_words")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .select("id");
    if (error || !data || data.length === 0) {
      console.error("[spell-words] remove", error?.message);
      return { error: "No se pudo quitar la palabra. Inténtalo de nuevo." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[spell-words] remove", err);
    return { error: "No se pudo quitar la palabra. Inténtalo de nuevo." };
  }
}
