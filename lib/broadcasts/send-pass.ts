// La parte de difusiones de cada pasada del cron de trabajos (cada minuto).
//
// Antes había un trabajo en scheduled_jobs por destinatario, mezclado con las
// esperas del bot en la misma cola. Ahora el cron toma directamente de
// broadcast_recipients un lote de pendientes de las difusiones que están
// "enviándose" (ver lib/broadcasts/pacing.ts para el ritmo y su razón). Así:
//   - Pausar y cancelar son un cambio de estado de la difusión; no hay miles de
//     trabajos que mover.
//   - Las difusiones tienen su propia porción de la pasada y nunca desplazan
//     plazos, reclamos, esperas del bot ni secuencias (que van antes o aparte).
//   - Varias pasadas a la vez no se pisan: cada destinatario se "toma" con una
//     actualización condicional (pendiente -> enviándose), de modo que a nadie se
//     le envía dos veces.
//
// Antes de CADA envío se vuelve a mirar que la difusión siga enviándose (si se
// pausó o canceló, no sale) y, dentro de deliverBroadcast, el consentimiento.

import type { Db } from "@/lib/cases/io";
import { notify, workspaceAdminIds } from "@/lib/cases/io";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/lib/types/database";
import { loadBroadcastProgress } from "./control";
import type { DeliveryResult } from "./delivery";
import {
  BROADCAST_AUTO_PAUSE_AFTER_FAILURES,
  BROADCAST_CONCURRENCY,
  BROADCAST_MAX_PER_PASS,
  BROADCAST_SENDS_PER_PASS,
  BROADCAST_STALE_SENDING_MS,
} from "./pacing";

type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

export type DeliverFn = (
  db: Db,
  params: { workspaceId: string; contactId: string; channelId: string; messageContent: unknown },
) => Promise<DeliveryResult>;

// Motivos que se ven en el detalle de la difusión (los técnicos van solo al registro).
export const BROADCAST_INTERRUPTED_MESSAGE =
  "El envío se interrumpió y no se sabe si el mensaje llegó. Revisa el chat del contacto antes de volver a enviarlo.";
const UNEXPECTED_ERROR_MESSAGE = "No se pudo enviar el mensaje por un error inesperado. Inténtalo de nuevo más tarde.";

export interface SendPassOptions {
  /** Instante (ms) pasado el cual no se empieza otro envío. */
  deadline: number;
  maxSends?: number;
  concurrency?: number;
  autoPauseAfter?: number;
  /** Para las pruebas; por defecto, el envío real (lib/broadcasts/deliver.ts). */
  deliver?: DeliverFn;
  now?: () => number;
}

export interface SendPassResult {
  sent: number;
  failed: number;
  skipped: number;
  /** Cuántos destinatarios se tomaron para enviar en esta pasada. */
  attempted: number;
  /** Difusiones que se pausaron solas en esta pasada. */
  autoPaused: string[];
  /** Envíos que se habían quedado cortados y se marcaron como fallidos. */
  interrupted: number;
}

type Outcome = "sent" | "failed" | "skipped" | "not_sent";
interface RecipientResult {
  outcome: Outcome;
  /** Solo con not_sent: la difusión ya no está enviándose (pausada, cancelada o terminada). */
  notLive?: boolean;
  general?: boolean;
  error?: string;
}

/** El envío real, cargado una sola vez por pasada (así no se carga Zernio si no hay nada que enviar). */
async function loadDeliver(): Promise<DeliverFn> {
  const { deliverBroadcast } = await import("./deliver");
  return deliverBroadcast;
}

/** Reparte `items` entre `size` trabajadores a la vez. */
async function runPool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

/** Envía a un destinatario: comprueba que la difusión siga activa, lo toma, envía y anota el resultado. */
async function processRecipient(
  db: Db,
  broadcast: BroadcastRow,
  recipient: { id: string; contact_id: string; channel_id: string },
  deliver: DeliverFn,
  now: () => number,
): Promise<RecipientResult> {
  // 1. ¿Sigue enviándose? (se pudo pausar o cancelar desde que empezó la pasada)
  const { data: live, error: liveError } = await db.from("broadcasts").select("status").eq("id", broadcast.id).maybeSingle();
  if (liveError) {
    console.error("[broadcasts/send] no se pudo leer el estado", liveError.message);
    return { outcome: "not_sent" };
  }
  if (!live || live.status !== "sending") return { outcome: "not_sent", notLive: true };

  // 2. Tomarlo (solo si sigue pendiente): si otra pasada o una cancelación llegó antes, no se envía.
  const { data: claimed, error: claimError } = await db
    .from("broadcast_recipients")
    .update({ status: "sending", claimed_at: new Date(now()).toISOString() })
    .eq("id", recipient.id)
    .eq("status", "pending")
    .select("id");
  if (claimError) {
    // Resultado desconocido: si se aplicó, el barrido de envíos cortados lo marcará como fallido; no se envía nada.
    console.error("[broadcasts/send] no se pudo tomar al destinatario", claimError.message);
    return { outcome: "not_sent" };
  }
  if (!claimed || claimed.length === 0) return { outcome: "not_sent" };

  // 3. Enviar (el consentimiento se vuelve a comprobar dentro).
  let delivery: DeliveryResult;
  try {
    delivery = await deliver(db, {
      workspaceId: broadcast.workspace_id,
      contactId: recipient.contact_id,
      channelId: recipient.channel_id,
      messageContent: broadcast.message_content,
    });
  } catch (err) {
    console.error(`[broadcasts/send] el envío al destinatario ${recipient.id} lanzó un error:`, err);
    delivery = { ok: false, error: UNEXPECTED_ERROR_MESSAGE, general: true };
  }

  // 4. Anotar el resultado, solo si el destinatario sigue "enviándose" (si no, otra pasada ya lo cerró y no se cuenta dos veces).
  const outcome: Outcome = delivery.ok ? "sent" : delivery.skipped ? "skipped" : "failed";
  const patch =
    delivery.ok
      ? { status: "sent", sent_at: new Date(now()).toISOString(), error_message: null }
      : { status: outcome === "skipped" ? "skipped" : "failed", error_message: delivery.error };
  const { data: settled, error: settleError } = await db
    .from("broadcast_recipients")
    .update(patch)
    .eq("id", recipient.id)
    .eq("status", "sending")
    .select("id");
  if (settleError) {
    // Queda "enviándose": el barrido de envíos cortados lo marcará como fallido con el aviso de revisar el chat.
    console.error("[broadcasts/send] no se pudo anotar el resultado", settleError.message);
  } else if (settled && settled.length > 0) {
    if (outcome === "sent") await db.rpc("increment_broadcast_sent", { b_id: broadcast.id });
    if (outcome === "failed") await db.rpc("increment_broadcast_failed", { b_id: broadcast.id });
  }

  return {
    outcome,
    general: !delivery.ok && !delivery.skipped && delivery.general === true,
    error: delivery.ok ? undefined : delivery.error,
  };
}

/** Marca como terminada la difusión cuando no queda nadie pendiente ni enviándose. */
export async function settleBroadcastIfDone(db: Db, broadcastId: string): Promise<void> {
  const { count, error } = await db
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .in("status", ["pending", "sending"]);
  if (error || count !== 0) return;
  await db.from("broadcasts").update({ status: "completed" }).eq("id", broadcastId).in("status", ["sending", "paused"]);
}

/** Envíos que se quedaron "enviándose" demasiado tiempo (la función se cortó): fallidos, sin reenviar. */
async function settleInterrupted(db: Db, now: () => number): Promise<number> {
  const cutoff = new Date(now() - BROADCAST_STALE_SENDING_MS).toISOString();
  const { data: stuck, error } = await db
    .from("broadcast_recipients")
    .select("id, broadcast_id")
    .eq("status", "sending")
    .lt("claimed_at", cutoff)
    .limit(100);
  if (error) {
    console.error("[broadcasts/send] no se pudieron buscar envíos cortados", error.message);
    return 0;
  }
  let settledCount = 0;
  const touched = new Set<string>();
  for (const row of stuck ?? []) {
    // Un duplicado visible al cliente es peor que un falso fallo: no se reenvía, se marca fallido.
    const { data: settled, error: settleError } = await db
      .from("broadcast_recipients")
      .update({ status: "failed", error_message: BROADCAST_INTERRUPTED_MESSAGE })
      .eq("id", row.id)
      .eq("status", "sending")
      .select("id");
    if (settleError) {
      console.error("[broadcasts/send] no se pudo cerrar un envío cortado", settleError.message);
      continue;
    }
    if (settled && settled.length > 0) {
      settledCount++;
      await db.rpc("increment_broadcast_failed", { b_id: row.broadcast_id });
    }
    touched.add(row.broadcast_id);
  }
  for (const id of touched) await settleBroadcastIfDone(db, id);
  return settledCount;
}

/** Pausa sola la difusión tras fallos seguidos y avisa al Dueño y a los Administradores. Devuelve si la pausó. */
async function pauseAutomatically(db: Db, broadcast: BroadcastRow, streak: number, lastError: string): Promise<boolean> {
  const note = `Se pausó sola: ${streak} envíos seguidos fallaron.${lastError ? ` Último motivo: ${lastError}` : ""}`.slice(0, 300);
  const { data: paused, error } = await db
    .from("broadcasts")
    .update({
      status: "paused",
      paused_at: new Date().toISOString(),
      paused_reason: "auto_failures",
      pause_note: note,
      consecutive_failures: streak,
    })
    .eq("id", broadcast.id)
    .eq("status", "sending")
    .select("id");
  if (error) {
    console.error("[broadcasts/send] no se pudo pausar sola", error.message);
    return false;
  }
  // Alguien la pausó o la canceló justo antes: no hay nada que avisar.
  if (!paused || paused.length === 0) return false;

  const progress = await loadBroadcastProgress(db, broadcast.id);
  await logAudit(db, {
    workspaceId: broadcast.workspace_id,
    actorId: null,
    action: "broadcast_auto_paused",
    entity: "broadcast",
    meta: {
      broadcast_id: broadcast.id,
      consecutive_failures: streak,
      sent: progress?.sent ?? null,
      pending: progress?.pending ?? null,
    },
  });
  try {
    const admins = await workspaceAdminIds(db, broadcast.workspace_id);
    const left = progress ? ` Ya recibieron el mensaje ${progress.sent} y faltan ${progress.pending}.` : "";
    await notify(
      db,
      admins.map((userId) => ({
        workspace_id: broadcast.workspace_id,
        user_id: userId,
        type: "broadcast_paused" as const,
        title: "Una difusión se pausó sola",
        body: `«${broadcast.name}» se pausó porque ${streak} envíos seguidos fallaron.${left} Revisa la conexión con Zernio y WhatsApp y reanúdala desde Difusiones.`,
        link: `/dashboard/broadcasts?broadcast=${encodeURIComponent(broadcast.id)}`,
      })),
    );
  } catch (err) {
    console.error("[broadcasts/send] no se pudo avisar a los administradores:", err);
  }
  return true;
}

/** Envía un lote de una difusión. Devuelve cuántos destinatarios se tomaron. */
async function runBroadcast(
  db: Db,
  broadcast: BroadcastRow,
  quota: number,
  opts: Required<Pick<SendPassOptions, "deadline" | "concurrency" | "autoPauseAfter" | "deliver" | "now">>,
  result: SendPassResult,
): Promise<number> {
  const { data: pending, error } = await db
    .from("broadcast_recipients")
    .select("id, contact_id, channel_id")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending")
    .limit(quota);
  if (error) {
    console.error("[broadcasts/send] no se pudieron leer los pendientes", error.message);
    return 0;
  }
  if (!pending || pending.length === 0) {
    await settleBroadcastIfDone(db, broadcast.id);
    return 0;
  }

  const startStreak = broadcast.consecutive_failures ?? 0;
  let streak = startStreak;
  let lastError = "";
  let halted = false;
  let tripped = false;
  let attempted = 0;

  await runPool(pending, opts.concurrency, async (recipient) => {
    if (halted || opts.now() >= opts.deadline) return;
    const res = await processRecipient(db, broadcast, recipient, opts.deliver, opts.now);
    if (res.outcome === "not_sent") {
      if (res.notLive) halted = true;
      return;
    }
    attempted++;
    if (res.outcome === "sent") {
      result.sent++;
      streak = 0;
    } else if (res.outcome === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
      // Un fallo del contacto (sin teléfono, ventana cerrada...) ni suma ni reinicia: solo cuentan los generales.
      if (res.general) {
        streak++;
        lastError = res.error ?? lastError;
      }
    }
    if (streak >= opts.autoPauseAfter && !tripped) {
      tripped = true;
      halted = true;
    }
  });

  if (tripped) {
    if (await pauseAutomatically(db, broadcast, streak, lastError)) result.autoPaused.push(broadcast.id);
  } else if (streak !== startStreak) {
    await db.from("broadcasts").update({ consecutive_failures: streak }).eq("id", broadcast.id);
  }
  await settleBroadcastIfDone(db, broadcast.id);
  return attempted;
}

/**
 * La parte de difusiones de una pasada del cron: cierra los envíos cortados y
 * envía lotes de las difusiones en curso, de la más antigua a la más nueva, hasta
 * agotar la porción de la pasada (envíos o tiempo).
 */
export async function runBroadcastSendPass(db: Db, options: SendPassOptions): Promise<SendPassResult> {
  const now = options.now ?? Date.now;
  const opts = {
    deadline: options.deadline,
    concurrency: options.concurrency ?? BROADCAST_CONCURRENCY,
    autoPauseAfter: options.autoPauseAfter ?? BROADCAST_AUTO_PAUSE_AFTER_FAILURES,
    deliver: options.deliver,
    now,
  };
  const result: SendPassResult = { sent: 0, failed: 0, skipped: 0, attempted: 0, autoPaused: [], interrupted: 0 };

  result.interrupted = await settleInterrupted(db, now);

  const { data: live, error } = await db
    .from("broadcasts")
    .select("*")
    .eq("status", "sending")
    .order("created_at", { ascending: true })
    .limit(BROADCAST_MAX_PER_PASS);
  if (error) {
    console.error("[broadcasts/send] no se pudieron leer las difusiones", error.message);
    throw new Error(`broadcasts: ${error.message}`);
  }

  if (!live || live.length === 0) return result;
  const deliver = opts.deliver ?? (await loadDeliver());

  let quota = options.maxSends ?? BROADCAST_SENDS_PER_PASS;
  for (const broadcast of live) {
    if (quota <= 0 || now() >= opts.deadline) break;
    const attempted = await runBroadcast(db, broadcast, quota, { ...opts, deliver }, result);
    result.attempted += attempted;
    quota -= attempted;
  }
  return result;
}
