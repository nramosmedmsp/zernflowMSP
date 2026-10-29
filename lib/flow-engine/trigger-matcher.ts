import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

interface IncomingMessage {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  sender?: { id: string };
}

type Trigger = Database["public"]["Tables"]["triggers"]["Row"];

/** Lo mínimo de un disparador que necesita la coincidencia. */
export interface MatchableMessageTrigger {
  type: string;
  config: unknown;
  /** Mayor prioridad corre primero. */
  priority?: number | null;
  id?: string;
}

type KeywordMatchType = "exact" | "contains" | "startsWith";

interface KeywordConfig {
  keywords?: Array<string | { value: string; matchType?: KeywordMatchType }>;
  matchType?: KeywordMatchType;
}

/** Cómo coincidió un disparador con el mensaje (para explicarlo en la simulación). */
export type TriggerMatchReason =
  | { via: "postback"; payload: string }
  | { via: "quick_reply"; payload: string }
  | { via: "keyword"; keyword: string; matchType: KeywordMatchType }
  | { via: "welcome" }
  | { via: "default" };

/**
 * Primera palabra clave del disparador que coincide con el texto (el texto se
 * compara en minúsculas y sin espacios en los extremos). Admite palabras como
 * texto o como objeto { value, matchType }; sin tipo propio usa el del
 * disparador y, si tampoco, "contiene".
 */
export function findKeywordMatch(
  config: unknown,
  rawText: string,
): { keyword: string; matchType: KeywordMatchType } | null {
  const keywordConfig = (config ?? {}) as KeywordConfig;
  if (!keywordConfig.keywords) return null;
  const text = rawText.toLowerCase().trim();

  for (const kw of keywordConfig.keywords) {
    // Support both formats: plain string or { value, matchType } object
    const keyword = (typeof kw === "string" ? kw : kw.value).toLowerCase();
    const matchType = (typeof kw === "object" && kw.matchType) || keywordConfig.matchType || "contains";

    if (matchType === "exact" && text === keyword) return { keyword, matchType };
    if (matchType === "contains" && text.includes(keyword)) return { keyword, matchType };
    if (matchType === "startsWith" && text.startsWith(keyword)) return { keyword, matchType };
  }
  return null;
}

const MATCH_RANK: Record<KeywordMatchType, number> = { exact: 0, startsWith: 1, contains: 2 };

/**
 * Desempate entre palabras clave que coinciden con el mismo mensaje: mayor
 * prioridad del disparador, luego la coincidencia más precisa (exacta, empieza
 * con, contiene) y luego la palabra más larga (la más específica). Si aún
 * empatan, queda el orden de la lista (matchTrigger la pide ordenada por
 * prioridad y antigüedad, así que tampoco es azar).
 */
function compareKeywordMatches(
  a: { trigger: MatchableMessageTrigger; found: { keyword: string; matchType: KeywordMatchType } },
  b: { trigger: MatchableMessageTrigger; found: { keyword: string; matchType: KeywordMatchType } },
): number {
  return (
    (b.trigger.priority ?? 0) - (a.trigger.priority ?? 0) ||
    MATCH_RANK[a.found.matchType] - MATCH_RANK[b.found.matchType] ||
    b.found.keyword.length - a.found.keyword.length
  );
}

/**
 * Elige el disparador de un mensaje entrante entre los candidatos (activos, de
 * flujos publicados y ya ordenados por prioridad, de mayor a menor). Sin E/S:
 * lo usan matchTrigger y el laboratorio de conversaciones.
 *
 * Orden de prioridad: postback > respuesta rápida > palabra clave > bienvenida
 * (primer mensaje del contacto) > por defecto.
 */
export function selectTrigger<T extends MatchableMessageTrigger>(
  triggers: readonly T[],
  message: IncomingMessage,
  isFirstMessage: boolean,
): { trigger: T; reason: TriggerMatchReason } | null {
  if (triggers.length === 0) return null;

  // 1. Check postback triggers
  if (message.postbackPayload) {
    const match = triggers.find(
      (t) => t.type === "postback" && (t.config as { payload?: string })?.payload === message.postbackPayload,
    );
    if (match) return { trigger: match, reason: { via: "postback", payload: message.postbackPayload } };
  }

  // 2. Check quick_reply triggers
  if (message.quickReplyPayload) {
    const match = triggers.find(
      (t) => t.type === "quick_reply" && (t.config as { payload?: string })?.payload === message.quickReplyPayload,
    );
    if (match) return { trigger: match, reason: { via: "quick_reply", payload: message.quickReplyPayload } };
  }

  // 3. Check keyword triggers. Si varios coinciden, el desempate es fijo (B-17).
  if (message.text) {
    const matches: Array<{ trigger: T; found: { keyword: string; matchType: KeywordMatchType } }> = [];
    for (const trigger of triggers.filter((t) => t.type === "keyword")) {
      const found = findKeywordMatch(trigger.config, message.text);
      if (found) matches.push({ trigger, found });
    }
    if (matches.length > 0) {
      matches.sort(compareKeywordMatches);
      const best = matches[0];
      return { trigger: best.trigger, reason: { via: "keyword", ...best.found } };
    }
  }

  // 4. Check welcome trigger (first inbound message for this contact on this channel)
  if (isFirstMessage) {
    const welcomeTrigger = triggers.find((t) => t.type === "welcome");
    if (welcomeTrigger) return { trigger: welcomeTrigger, reason: { via: "welcome" } };
  }

  // 5. Default trigger
  const defaultTrigger = triggers.find((t) => t.type === "default");
  return defaultTrigger ? { trigger: defaultTrigger, reason: { via: "default" } } : null;
}

export async function matchTrigger(
  supabase: SupabaseClient<Database>,
  {
    channelId,
    workspaceId,
    conversationId,
    message,
    isFirstMessage,
  }: {
    channelId: string;
    workspaceId: string;
    conversationId: string;
    message: IncomingMessage;
    /** Caller-known "first inbound message" signal; inbound messages are not
     * mirrored locally, so the legacy count query below always sees 0. */
    isFirstMessage?: boolean;
  }
): Promise<Trigger | null> {
  // Triggers with null channel_id are workspace-wide, NOT global: the flows
  // join must be pinned to the channel's workspace or one tenant's triggers
  // (and flows) would run on another tenant's channels.
  const { data: triggers } = await supabase
    .from("triggers")
    .select("*, flows!inner(status, workspace_id)")
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .eq("is_active", true)
    .eq("flows.status", "published")
    .eq("flows.workspace_id", workspaceId)
    .order("priority", { ascending: false })
    // Orden estable entre disparadores empatados (B-17): el más antiguo primero.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (!triggers || triggers.length === 0) return null;

  let selected = selectTrigger(triggers, message, isFirstMessage === true);
  // Only a welcome/default/no match depends on the first-message signal, so the
  // legacy count query runs only then (and only when the caller did not pass it).
  if (isFirstMessage === undefined && (!selected || selected.reason.via === "default")) {
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound");
    selected = selectTrigger(triggers, message, count === 1);
  }

  return selected?.trigger ?? null;
}
