// Bandeja de entrada durable de los mensajes de Zernio (CONF-06 / CONF-07).
//
// Antes, el id del evento se "reclamaba" antes de guardar contacto y chat y
// solo se guardaba el id: si la función se cortaba o el trabajo posterior
// fallaba, el reintento de Zernio recibía "duplicado" y el mensaje quedaba sin
// gestión ni bot, sin que nadie se enterara.
//
// Ahora cada mensaje entrante deja una fila en webhook_events (00041) con:
//   status   received -> stored -> processed (o failed tras agotar intentos)
//   payload  el cuerpo ya verificado y reducido (NULL al quedar processed)
//   avance   contact_id / conversation_id / cases_ok_at / flows_started_at,
//            para que un reintento no repita lo hecho (ni la respuesta del bot)
// y un candado corto (locked_until) para que dos ejecuciones no lo procesen a la vez.
//
// Quién procesa:
//   * el webhook: reclama, guarda contacto y chat antes de responder y deja el
//     trabajo posterior para after();
//   * el cron (sweepInboundEvents): retoma los pendientes cuyo candado venció;
//   * el cron (sweepOrphanChats): chats con mensaje entrante reciente sin
//     gestión que lo cubra (eventos que no dejaron fila, o filas ya podadas).

import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, workspaceAdminIds } from "@/lib/cases/io";
import { prepareInboundMessage } from "@/lib/inbound-conversation";
import { runInboundPipeline } from "@/lib/inbound-pipeline";
import type { Database, Json } from "@/lib/types/database";

type Db = SupabaseClient<Database>;
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];
export type InboundEventRow = Database["public"]["Tables"]["webhook_events"]["Row"];

/** Intentos totales (el primero incluido) antes de marcar el evento como fallido. */
export const MAX_INBOUND_ATTEMPTS = 3;
/** Cuánto dura el candado de quien está procesando (la función dura como mucho 60 s). */
export const INBOUND_LOCK_MS = 60_000;
/** Espera entre intentos del barrido tras un fallo: 2 min, luego 4 min. */
const RETRY_BACKOFF_MS = 2 * 60_000;
/** Datos de eventos ya procesados: 48 h (ventana de reintentos de Zernio). */
export const PROCESSED_RETENTION_MS = 48 * 60 * 60 * 1000;
/** Eventos pendientes o fallidos (con su cuerpo, para reprocesar): 7 días. */
export const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SENTINEL_UNTRACKED = "";

// ── Cuerpo reducido ─────────────────────────────────────────────────────────

/** Lo mínimo del evento para reprocesarlo. Sin fotos, enlaces de archivos ni foto de perfil. */
export interface StoredInboundPayload {
  v: 1;
  /** Cuándo llegó (ISO): fecha del chat y de la gestión al reprocesar. */
  at: string;
  preview: string;
  lateConversationId: string;
  lateAccountId: string;
  platformMessageId: string | null;
  text: string | null;
  sender: { id: string; name: string; username: string | null };
  metadata?: { postbackPayload?: string; quickReplyPayload?: string; callbackData?: string };
  /** Evento sintético creado por el barrido de chats sin gestión (no llegó de Zernio). */
  orphan?: boolean;
}

export function buildStoredPayload(input: {
  at: string;
  preview: string;
  lateConversationId: string;
  lateAccountId: string;
  platformMessageId?: string | null;
  text?: string | null;
  sender: { id: string; name?: string | null; username?: string | null };
  metadata?: { postbackPayload?: string; quickReplyPayload?: string; callbackData?: string } | null;
}): StoredInboundPayload {
  const meta: NonNullable<StoredInboundPayload["metadata"]> = {};
  if (input.metadata?.postbackPayload) meta.postbackPayload = input.metadata.postbackPayload;
  if (input.metadata?.quickReplyPayload) meta.quickReplyPayload = input.metadata.quickReplyPayload;
  if (input.metadata?.callbackData) meta.callbackData = input.metadata.callbackData;
  return {
    v: 1,
    at: input.at,
    preview: input.preview,
    lateConversationId: input.lateConversationId,
    lateAccountId: input.lateAccountId,
    platformMessageId: input.platformMessageId ?? null,
    text: input.text ?? null,
    sender: { id: input.sender.id, name: input.sender.name ?? "", username: input.sender.username ?? null },
    ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
  };
}

export function parseStoredPayload(raw: Json | null): StoredInboundPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as unknown as Partial<StoredInboundPayload>;
  if (p.v !== 1 || typeof p.at !== "string" || !p.sender || typeof p.sender !== "object") return null;
  if (typeof p.sender.id !== "string") return null;
  return p as StoredInboundPayload;
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

function isTracked(row: InboundEventRow): boolean {
  return row.event_id !== SENTINEL_UNTRACKED;
}

// ── Reclamar el evento ──────────────────────────────────────────────────────

export type ClaimResult =
  /** Primera vez que llega el evento. */
  | { kind: "new"; row: InboundEventRow }
  /** Ya existía pero sin terminar y sin nadie procesándolo: este intento lo retoma. */
  | { kind: "retake"; row: InboundEventRow }
  /** Ya procesado (o fallido, o lo está procesando otro ahora): no hacer nada. */
  | { kind: "duplicate" }
  /** No se pudo escribir la bandeja (tabla o columnas ausentes, base con fallo): se procesa sin ella. */
  | { kind: "untracked"; row: InboundEventRow };

function untrackedRow(channelId: string, payload: StoredInboundPayload): InboundEventRow {
  const now = new Date().toISOString();
  return {
    event_id: SENTINEL_UNTRACKED,
    received_at: now,
    status: "received",
    event_type: "message.received",
    channel_id: channelId,
    payload: payload as unknown as Json,
    attempts: 1,
    last_error: null,
    locked_until: null,
    contact_id: null,
    conversation_id: null,
    is_first_message: null,
    cases_ok_at: null,
    flows_started_at: null,
    updated_at: now,
    processed_at: null,
  };
}

/**
 * Toma el evento con una actualización condicional (suma un intento y pone el
 * candado). Solo prospera si nadie más lo tomó desde que se leyó la fila.
 */
async function takeEvent(db: Db, row: InboundEventRow, now: Date): Promise<InboundEventRow | null> {
  const { data, error } = await db
    .from("webhook_events")
    .update({
      attempts: row.attempts + 1,
      locked_until: new Date(now.getTime() + INBOUND_LOCK_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("event_id", row.event_id)
    .eq("attempts", row.attempts)
    .in("status", ["received", "stored"])
    .select("*");
  if (error) {
    console.error("[inbound] no se pudo tomar el evento:", error.message);
    return null;
  }
  return data && data.length > 0 ? (data[0] as InboundEventRow) : null;
}

export async function claimInboundEvent(
  db: Db,
  args: { eventId: string; channelId: string; payload: StoredInboundPayload; now?: Date },
): Promise<ClaimResult> {
  const now = args.now ?? new Date();
  const { data, error } = await db
    .from("webhook_events")
    .insert({
      event_id: args.eventId,
      status: "received",
      event_type: "message.received",
      channel_id: args.channelId,
      payload: args.payload as unknown as Json,
      attempts: 1,
      locked_until: new Date(now.getTime() + INBOUND_LOCK_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .select("*")
    .single();
  if (!error && data) return { kind: "new", row: data as InboundEventRow };

  if (error && error.code !== "23505") {
    // Tabla o columnas ausentes, base con un fallo pasajero: no se descarta el mensaje.
    console.error("[inbound] no se pudo reclamar el evento (se procesa sin bandeja durable):", error.message);
    return { kind: "untracked", row: untrackedRow(args.channelId, args.payload) };
  }

  // Ya lo había visto: ¿terminó, o quedó a medias?
  const { data: existing, error: readError } = await db
    .from("webhook_events")
    .select("*")
    .eq("event_id", args.eventId)
    .maybeSingle();
  if (readError || !existing) {
    console.error("[inbound] no se pudo leer el evento repetido:", readError?.message);
    return { kind: "untracked", row: untrackedRow(args.channelId, args.payload) };
  }
  const row = existing as InboundEventRow;
  if (row.status === "processed" || row.status === "failed") return { kind: "duplicate" };
  // Lo está procesando otra ejecución (candado vigente): ese intento o el barrido terminan.
  if (row.locked_until && new Date(row.locked_until).getTime() > now.getTime()) return { kind: "duplicate" };
  // Sin cuerpo (fila escrita por el código anterior): no hay nada que retomar.
  if (!row.payload) return { kind: "duplicate" };
  if (row.attempts >= MAX_INBOUND_ATTEMPTS) {
    await failEvent(db, row, row.last_error ?? "se agotaron los intentos");
    return { kind: "duplicate" };
  }
  const taken = await takeEvent(db, row, now);
  return taken ? { kind: "retake", row: taken } : { kind: "duplicate" };
}

// ── Avance ──────────────────────────────────────────────────────────────────

async function patchEvent(db: Db, row: InboundEventRow, patch: Database["public"]["Tables"]["webhook_events"]["Update"]) {
  Object.assign(row, patch);
  if (!isTracked(row)) return;
  const { error } = await db
    .from("webhook_events")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("event_id", row.event_id);
  if (error) console.error("[inbound] no se pudo actualizar el evento:", error.message);
}

/** Terminado: se borra el cuerpo (no se guardan datos personales de lo ya hecho). */
async function markProcessed(db: Db, row: InboundEventRow) {
  await patchEvent(db, row, {
    status: "processed",
    payload: null,
    last_error: null,
    locked_until: null,
    processed_at: new Date().toISOString(),
  });
}

/** Pasa a 'failed' y avisa a los administradores una sola vez. */
async function failEvent(db: Db, row: InboundEventRow, error: string) {
  await patchEvent(db, row, { status: "failed", last_error: error.slice(0, 300), locked_until: null });
  console.error(`[inbound] evento ${row.event_id} fallido tras ${row.attempts} intentos: ${error}`);
  await notifyAdminsOfFailure(db, row);
}

async function notifyAdminsOfFailure(db: Db, row: InboundEventRow) {
  try {
    let workspaceId: string | null = null;
    if (row.channel_id) {
      const { data } = await db.from("channels").select("workspace_id").eq("id", row.channel_id).maybeSingle();
      workspaceId = data?.workspace_id ?? null;
    }
    if (!workspaceId) return;
    const admins = await workspaceAdminIds(db, workspaceId);
    await notify(
      db,
      admins.map((userId) => ({
        workspace_id: workspaceId as string,
        user_id: userId,
        type: "inbound_failed" as const,
        title: "Un mensaje de un cliente no se pudo procesar",
        body: "Se reintentó varias veces sin éxito. Revisa la conversación en la Bandeja y asigna la gestión a mano si hace falta.",
        link: row.contact_id ? `/dashboard/inbox?contact=${row.contact_id}` : "/dashboard/settings",
      })),
    );
  } catch (err) {
    console.error("[inbound] no se pudo avisar a los administradores:", err);
  }
}

/**
 * Un intento falló. Con intentos de sobra se libera (o se aplaza) el candado y
 * lo retoma el reintento de Zernio o el barrido; si ya fueron MAX, pasa a failed.
 */
async function recordAttemptFailure(db: Db, row: InboundEventRow, error: string, opts: { immediate: boolean }) {
  if (row.attempts >= MAX_INBOUND_ATTEMPTS) {
    await failEvent(db, row, error);
    return "failed" as const;
  }
  const lockedUntil = opts.immediate ? null : new Date(Date.now() + RETRY_BACKOFF_MS * row.attempts).toISOString();
  await patchEvent(db, row, { last_error: error.slice(0, 300), locked_until: lockedUntil });
  return "retry" as const;
}

// ── Guardar contacto y chat (antes de responder a Zernio) ───────────────────

export type PrepareOutcome = { ok: true; row: InboundEventRow } | { ok: false; error: string };

/**
 * Guarda contacto, chat y no leído. Es lo que debe estar hecho antes de decirle
 * "ok" a Zernio. Si el evento ya tenía esto hecho (status stored) no se repite,
 * así un reintento no suma el no leído dos veces.
 */
export async function prepareInboundEvent(db: Db, row: InboundEventRow, channel: ChannelRow): Promise<PrepareOutcome> {
  if (row.status === "stored" && row.contact_id && row.conversation_id) return { ok: true, row };
  const payload = parseStoredPayload(row.payload);
  if (!payload) return { ok: false, error: "el evento no tiene cuerpo guardado" };

  let prepared;
  try {
    prepared = await prepareInboundMessage(db, {
      channel,
      senderId: payload.sender.id,
      senderName: payload.sender.name || payload.sender.username || payload.sender.id,
      senderPicture: null,
      senderUsername: payload.sender.username,
      lateConversationId: payload.lateConversationId,
      preview: payload.preview,
      at: payload.at,
    });
  } catch (err) {
    prepared = { ok: false as const, error: errText(err) };
  }
  if (!prepared.ok) return { ok: false, error: prepared.error };

  await patchEvent(db, row, {
    status: "stored",
    contact_id: prepared.contactId,
    conversation_id: prepared.conversation.id,
    is_first_message: !prepared.existed,
    last_error: null,
  });
  return { ok: true, row };
}

/** El guardado inicial falló: se libera el candado para que el reintento de Zernio entre ya. */
export async function releaseAfterPrepareFailure(db: Db, row: InboundEventRow, error: string) {
  return recordAttemptFailure(db, row, error, { immediate: true });
}

// ── Trabajo posterior (gestión, reparto, bot) ───────────────────────────────

export type ProcessOutcome = "processed" | "retry" | "failed";

/**
 * Corre lo que sigue a guardar el mensaje (lib/inbound-pipeline.ts) saltando lo
 * que un intento anterior ya hizo. Nunca lanza: deja el resultado en la fila.
 */
export async function processStoredInbound(db: Db, row: InboundEventRow, channel: ChannelRow): Promise<ProcessOutcome> {
  const payload = parseStoredPayload(row.payload);
  if (!payload || !row.contact_id || !row.conversation_id) {
    return recordAttemptFailure(db, row, "al evento le falta el cuerpo o el chat guardado", { immediate: false });
  }
  try {
    // Estado actual del chat (el bot pudo pausarse entre intentos).
    const { data: conversation } = await db
      .from("conversations")
      .select("id, is_automation_paused")
      .eq("id", row.conversation_id)
      .maybeSingle();
    if (!conversation) {
      return recordAttemptFailure(db, row, "el chat del evento ya no existe", { immediate: false });
    }

    const retry = row.attempts > 1 || !!payload.orphan;
    const outcome = await runInboundPipeline(
      db,
      {
        channel,
        contactId: row.contact_id,
        conversation,
        isFirstMessage: !!row.is_first_message,
        message: {
          text: payload.text,
          postbackPayload: payload.metadata?.postbackPayload,
          quickReplyPayload: payload.metadata?.quickReplyPayload,
          callbackData: payload.metadata?.callbackData,
          sender: { id: payload.sender.id, name: payload.sender.name, username: payload.sender.username },
        },
        lateConversationId: payload.lateConversationId,
        lateAccountId: payload.lateAccountId,
        at: payload.at,
      },
      {
        skipCases: !!row.cases_ok_at,
        skipFlows: !!row.flows_started_at,
        skipAnalytics: retry,
        onCasesDone: () => patchEvent(db, row, { cases_ok_at: new Date().toISOString() }),
        onFlowsStart: () => patchEvent(db, row, { flows_started_at: new Date().toISOString() }),
      },
    );
    // Los mocks y llamadas antiguas pueden no devolver nada: solo `false` explícito es fallo.
    if (outcome && outcome.casesOk === false) {
      return recordAttemptFailure(db, row, outcome.casesError ?? "falló abrir o retomar la gestión", { immediate: false });
    }
    await markProcessed(db, row);
    return "processed";
  } catch (err) {
    console.error("[inbound] error en el trabajo posterior:", err);
    return recordAttemptFailure(db, row, errText(err), { immediate: false });
  }
}

// ── Barridos del cron ───────────────────────────────────────────────────────

export interface SweepStats {
  /** Eventos retomados en esta pasada. */
  retried: number;
  recovered: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Retoma los eventos pendientes cuyo candado venció (la función se cortó, el
 * trabajo posterior falló). Por lotes, con tope de tiempo e idempotente: dos
 * pasadas a la vez no procesan el mismo evento (la toma es condicional).
 */
export async function sweepInboundEvents(
  db: Db,
  opts: { deadline: number; limit?: number; now?: Date },
): Promise<SweepStats> {
  const stats: SweepStats = { retried: 0, recovered: 0, failed: 0, stoppedEarly: false };
  const now = opts.now ?? new Date();
  const { data, error } = await db
    .from("webhook_events")
    .select("*")
    .in("status", ["received", "stored"])
    .not("payload", "is", null)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .order("received_at", { ascending: true })
    .limit(opts.limit ?? 10);
  if (error) {
    console.error("[inbound] barrido: no se pudo leer la bandeja:", error.message);
    return stats;
  }

  for (const found of (data ?? []) as InboundEventRow[]) {
    if (Date.now() >= opts.deadline) {
      stats.stoppedEarly = true;
      break;
    }
    if (found.attempts >= MAX_INBOUND_ATTEMPTS) {
      await failEvent(db, found, found.last_error ?? "se agotaron los intentos");
      stats.failed++;
      continue;
    }
    const row = await takeEvent(db, found, now);
    if (!row) continue; // otra ejecución lo tomó primero
    stats.retried++;

    const { data: channel } = row.channel_id
      ? await db.from("channels").select("*").eq("id", row.channel_id).maybeSingle()
      : { data: null };
    if (!channel) {
      await failEvent(db, row, "el canal del evento ya no existe");
      stats.failed++;
      continue;
    }

    const prepared = await prepareInboundEvent(db, row, channel);
    if (!prepared.ok) {
      const result = await recordAttemptFailure(db, row, prepared.error, { immediate: false });
      if (result === "failed") stats.failed++;
      continue;
    }
    const result = await processStoredInbound(db, row, channel);
    if (result === "processed") stats.recovered++;
    else if (result === "failed") stats.failed++;
  }
  return stats;
}

/**
 * Chats con un mensaje entrante reciente que ninguna gestión cubre (el evento
 * no dejó fila, o el trabajo posterior se perdió): crea un evento sintético
 * 'stored' que el barrido de arriba procesa, con los mismos intentos, tope y
 * aviso a administradores. Nunca dispara el bot (flows_started_at ya puesto).
 * Idempotente: el id del evento sale de (chat, fecha del último mensaje).
 */
export async function sweepOrphanChats(
  db: Db,
  opts: { deadline: number; now?: Date; windowMs?: number; minAgeMs?: number; limit?: number; maxQueued?: number },
): Promise<{ found: number; queued: number }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowMs ?? 6 * 60 * 60 * 1000)).toISOString();
  const until = new Date(now.getTime() - (opts.minAgeMs ?? 3 * 60 * 1000)).toISOString();

  const { data: convs, error } = await db
    .from("conversations")
    .select("id, workspace_id, contact_id, channel_id, last_inbound_at")
    .gte("last_inbound_at", since)
    .lte("last_inbound_at", until)
    .order("last_inbound_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error || !convs || convs.length === 0) {
    if (error) console.error("[inbound] barrido de chats: no se pudo leer:", error.message);
    return { found: 0, queued: 0 };
  }

  const contactIds = [...new Set(convs.map((c) => c.contact_id))];
  const sinceIso = new Date(new Date(since).getTime() - 1000).toISOString();
  const { data: cases, error: casesError } = await db
    .from("cases")
    .select("contact_id, last_inbound_at, closed_at")
    .in("contact_id", contactIds)
    .or(`last_inbound_at.gte.${sinceIso},closed_at.gte.${sinceIso}`);
  if (casesError) {
    console.error("[inbound] barrido de chats: no se pudieron leer las gestiones:", casesError.message);
    return { found: 0, queued: 0 };
  }
  // Una gestión cubre el mensaje si se selló con él (o después, 1 s de holgura) o
  // si una persona la cerró después de que llegó: ya se atendió. Mejor dejar pasar
  // un chat dudoso que mandarle al cliente una respuesta de más.
  const coveredUntil = new Map<string, number>();
  for (const c of cases ?? []) {
    const seen = Math.max(
      c.last_inbound_at ? new Date(c.last_inbound_at).getTime() + 1000 : 0,
      c.closed_at ? new Date(c.closed_at).getTime() : 0,
    );
    if (seen > (coveredUntil.get(c.contact_id) ?? 0)) coveredUntil.set(c.contact_id, seen);
  }
  const orphans = convs.filter((c) => {
    if (!c.last_inbound_at) return false;
    return (coveredUntil.get(c.contact_id) ?? 0) < new Date(c.last_inbound_at).getTime();
  });

  let queued = 0;
  for (const conv of orphans.slice(0, opts.maxQueued ?? 10)) {
    if (Date.now() >= opts.deadline) break;
    const at = conv.last_inbound_at as string;
    const payload: StoredInboundPayload = {
      v: 1,
      at,
      preview: "",
      lateConversationId: "",
      lateAccountId: "",
      platformMessageId: null,
      text: null,
      sender: { id: "", name: "", username: null },
      orphan: true,
    };
    const { error: insertError } = await db.from("webhook_events").insert({
      event_id: `orphan:${conv.id}:${at}`,
      status: "stored",
      event_type: "orphan_chat",
      channel_id: conv.channel_id,
      payload: payload as unknown as Json,
      attempts: 0,
      contact_id: conv.contact_id,
      conversation_id: conv.id,
      is_first_message: false,
      // Los flujos del bot nunca se lanzan desde aquí: solo se retoma la gestión.
      flows_started_at: now.toISOString(),
    });
    if (!insertError) {
      queued++;
      console.warn(`[inbound] chat ${conv.id} con mensaje entrante sin gestión: se retoma`);
    } else if (insertError.code !== "23505") {
      console.error("[inbound] barrido de chats: no se pudo encolar:", insertError.message);
    }
  }
  return { found: orphans.length, queued };
}

/**
 * Poda de la bandeja: lo procesado a las 48 h (solo sirve para reconocer los
 * reintentos de Zernio) y todo lo demás —pendientes o fallidos, con su
 * cuerpo— a los 7 días.
 */
export async function pruneWebhookEvents(db: Db, now: Date = new Date()): Promise<void> {
  const processedCutoff = new Date(now.getTime() - PROCESSED_RETENTION_MS).toISOString();
  const otherCutoff = new Date(now.getTime() - FAILED_RETENTION_MS).toISOString();
  const first = await db.from("webhook_events").delete().eq("status", "processed").lt("received_at", processedCutoff);
  if (first.error) console.error("[inbound] poda (procesados):", first.error.message);
  const second = await db.from("webhook_events").delete().lt("received_at", otherCutoff);
  if (second.error) console.error("[inbound] poda (antiguos):", second.error.message);
}
