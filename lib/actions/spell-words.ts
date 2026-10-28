"use server";

// Diccionario de la tienda (corrector de la Bandeja, migraciones 00027 y 00028).
// Solo el Dueño o un Administrador agrega palabras; los demás miembros piden
// agregarlas y un administrador aprueba o rechaza el pedido. Las escrituras van
// con el cliente del usuario (la RLS lo exige); los avisos de la campana, con
// el de servicio.

import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/permissions";
import { createServiceClient } from "@/lib/supabase/server";
import { cleanSpellWord, normalizeWord } from "@/lib/spell-check";
import { readMemberNames } from "@/lib/flow-lab/scenarios/server";
import { notify, workspaceAdminIds } from "@/lib/cases/io";

export type SpellWordsResult<T extends object = object> = ({ ok: true } & T) | { error: string };

export interface SpellWordView {
  id: string;
  word: string;
  /** Quién la agregó o la pidió; null = lista inicial. */
  addedBy: string | null;
  createdAt: string;
}

export interface SpellWordsData {
  /** Palabras que usa el corrector. */
  words: SpellWordView[];
  /** Pedidos por revisar (el administrador ve todos; el miembro, los suyos). */
  pending: SpellWordView[];
  isAdmin: boolean;
}

const LINK = "/dashboard/settings/dictionary";
const NOT_ADMIN = "Solo el Dueño o un Administrador pueden aprobar o quitar palabras.";

export async function listSpellWords(): Promise<SpellWordsResult<{ data: SpellWordsData }>> {
  try {
    const { supabase, workspace, role, user } = await getWorkspace();
    const isAdmin = isAdminRole(role);
    const { data, error } = await supabase
      .from("spell_words")
      .select("id, word, added_by, status, created_at")
      .eq("workspace_id", workspace.id)
      .order("word", { ascending: true });
    if (error) {
      console.error("[spell-words] list", error.message);
      return { error: "No se pudo cargar el diccionario de la tienda." };
    }
    const rows = data ?? [];
    const names = rows.some((r) => r.added_by) ? await readMemberNames(workspace.id) : {};
    const view = (r: (typeof rows)[number]): SpellWordView => ({
      id: r.id,
      word: r.word,
      addedBy: r.added_by ? (r.added_by === user.id ? "Tú" : (names[r.added_by] ?? "Otra persona")) : null,
      createdAt: r.created_at,
    });
    return {
      ok: true,
      data: {
        isAdmin,
        words: rows.filter((r) => r.status === "approved").map(view),
        pending: rows.filter((r) => r.status === "pending" && (isAdmin || r.added_by === user.id)).map(view),
      },
    };
  } catch (err) {
    console.error("[spell-words] list", err);
    return { error: "No se pudo cargar el diccionario de la tienda." };
  }
}

/**
 * El administrador agrega la palabra (o aprueba el pedido que ya había); el
 * miembro deja un pedido y se avisa a los administradores.
 */
export async function addOrRequestSpellWord(
  raw: string,
): Promise<SpellWordsResult<{ status: "approved" | "pending"; word: SpellWordView }>> {
  const checked = cleanSpellWord(raw);
  if (!checked.ok) return { error: checked.error };
  try {
    const { supabase, workspace, role, user } = await getWorkspace();
    const isAdmin = isAdminRole(role);
    const normalized = normalizeWord(checked.word);
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("spell_words")
      .select("id, word, status, created_at")
      .eq("workspace_id", workspace.id)
      .eq("normalized", normalized)
      .maybeSingle();
    if (existing?.status === "approved") return { error: "Esa palabra ya está en el diccionario." };
    if (existing) {
      if (!isAdmin) return { error: "Esa palabra ya está pedida. Un administrador la revisará." };
      // El administrador agrega una palabra que alguien había pedido: se aprueba ese pedido.
      return approveSpellWord(existing.id);
    }

    const { data, error } = await supabase
      .from("spell_words")
      .insert({
        workspace_id: workspace.id,
        word: checked.word,
        normalized,
        added_by: user.id,
        status: isAdmin ? "approved" : "pending",
        approved_by: isAdmin ? user.id : null,
        approved_at: isAdmin ? now : null,
      })
      .select("id, word, created_at")
      .single();
    if (error || !data) {
      console.error("[spell-words] add", error?.message);
      return { error: "No se pudo guardar la palabra. Inténtalo de nuevo." };
    }

    if (!isAdmin) {
      const service = await createServiceClient();
      const admins = await workspaceAdminIds(service, workspace.id);
      const name = (await readMemberNames(workspace.id))[user.id] ?? "Un asesor";
      await notify(
        service,
        admins.map((id) => ({
          workspace_id: workspace.id,
          user_id: id,
          type: "spell_word_request",
          title: `${name} pide agregar «${checked.word}» al diccionario`,
          body: "Apruébala o recházala en Configuración → Diccionario de la tienda.",
          link: LINK,
        })),
      );
    }
    return {
      ok: true,
      status: isAdmin ? "approved" : "pending",
      word: { id: data.id, word: data.word, addedBy: "Tú", createdAt: data.created_at },
    };
  } catch (err) {
    console.error("[spell-words] add", err);
    return { error: "No se pudo guardar la palabra. Inténtalo de nuevo." };
  }
}

async function requesterOf(id: string) {
  const { supabase, workspace } = await getWorkspace();
  const { data } = await supabase
    .from("spell_words")
    .select("id, word, added_by, status, created_at")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  return data;
}

/** Aprueba un pedido: la palabra pasa al corrector y se avisa a quien la pidió. */
export async function approveSpellWord(
  id: string,
): Promise<SpellWordsResult<{ status: "approved"; word: SpellWordView }>> {
  try {
    const { supabase, workspace, role, user } = await getWorkspace();
    if (!isAdminRole(role)) return { error: NOT_ADMIN };
    const row = await requesterOf(id);
    if (!row) return { error: "No se encontró el pedido." };
    const { error } = await supabase
      .from("spell_words")
      .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspace.id);
    if (error) {
      console.error("[spell-words] approve", error.message);
      return { error: "No se pudo aprobar la palabra. Inténtalo de nuevo." };
    }
    if (row.status === "pending" && row.added_by && row.added_by !== user.id) {
      await notify(await createServiceClient(), [
        {
          workspace_id: workspace.id,
          user_id: row.added_by,
          type: "spell_word_approved",
          title: `«${row.word}» ya está en el diccionario de la tienda`,
          link: LINK,
        },
      ]);
    }
    const names = row.added_by ? await readMemberNames(workspace.id) : {};
    return {
      ok: true,
      status: "approved",
      word: {
        id: row.id,
        word: row.word,
        addedBy: row.added_by ? (row.added_by === user.id ? "Tú" : (names[row.added_by] ?? "Otra persona")) : null,
        createdAt: row.created_at,
      },
    };
  } catch (err) {
    console.error("[spell-words] approve", err);
    return { error: "No se pudo aprobar la palabra. Inténtalo de nuevo." };
  }
}

/** Rechaza un pedido (se borra) y avisa a quien lo pidió. */
export async function rejectSpellWord(id: string): Promise<SpellWordsResult> {
  try {
    const { workspace, role, user } = await getWorkspace();
    if (!isAdminRole(role)) return { error: NOT_ADMIN };
    const row = await requesterOf(id);
    if (!row || row.status !== "pending") return { error: "No se encontró el pedido." };
    const removed = await removeSpellWord(id);
    if ("error" in removed) return removed;
    if (row.added_by && row.added_by !== user.id) {
      await notify(await createServiceClient(), [
        {
          workspace_id: workspace.id,
          user_id: row.added_by,
          type: "spell_word_rejected",
          title: `No se agregó «${row.word}» al diccionario de la tienda`,
          link: LINK,
        },
      ]);
    }
    return { ok: true };
  } catch (err) {
    console.error("[spell-words] reject", err);
    return { error: "No se pudo rechazar el pedido. Inténtalo de nuevo." };
  }
}

export async function removeSpellWord(id: string): Promise<SpellWordsResult> {
  try {
    const { supabase, workspace, role } = await getWorkspace();
    if (!isAdminRole(role)) return { error: NOT_ADMIN };
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
