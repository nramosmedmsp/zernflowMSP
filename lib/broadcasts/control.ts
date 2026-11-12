// Pausar, reanudar y cancelar una difusión en curso, y leer su avance.
//
// SIN CARRERAS (el cron puede estar enviando en el mismo momento)
//   Cada cambio de estado de la difusión es UNA actualización condicional (solo
//   si sigue en el estado esperado): quien llega segundo no la gana. Y el cron,
//   antes de enviarle a cada destinatario, (1) vuelve a leer que la difusión siga
//   "enviándose" y (2) toma al destinatario con otra actualización condicional
//   (pendiente -> enviándose). Por eso:
//     - Pausar no toca a los destinatarios: lo que ya está enviándose termina
//       como enviado o fallido, y los pendientes esperan intactos. Reanudar los
//       encuentra tal cual: nadie recibe el mensaje dos veces.
//     - Cancelar cambia la difusión y DESPUÉS pasa los pendientes a "cancelado"
//       (solo los que siguen pendientes). Si el cron tomó a alguien justo antes,
//       esa persona termina como enviada o fallida: nunca queda en un estado
//       intermedio ni se le envía dos veces.
//   Un envío que ya salió hacia Zernio cuando se pausa o se cancela no se puede
//   recoger: es a lo más uno por envío en curso (hasta BROADCAST_CONCURRENCY).

import type { Db } from "@/lib/cases/io";
import { logAudit } from "@/lib/audit";
import { RECIPIENT_STATUSES, progressFromCounts, waitingCount, type BroadcastProgress, type RecipientStatus } from "./status";
import type { BroadcastStatus } from "@/lib/types/database";

export const BROADCAST_NOT_FOUND_MESSAGE = "No se encontró la difusión";
export const BROADCAST_CONTROL_FAILED_MESSAGE = "No se pudo completar la operación. Inténtalo de nuevo.";
export const BROADCAST_CANCELLED_RECIPIENT_MESSAGE = "La difusión se canceló antes de enviarle el mensaje.";

export type ControlOutcome =
  | {
      ok: true;
      /** false = ya estaba en ese estado (por ejemplo, dos personas pausaron a la vez). */
      changed: boolean;
      status: BroadcastStatus;
      progress: BroadcastProgress;
    }
  | { ok: false; status: number; error: string };

export interface ControlParams {
  workspaceId: string;
  broadcastId: string;
  /** Quién lo hace (queda en el registro). */
  actorId: string;
}

/** "una difusión que está terminada": el estado dicho en una frase. */
const STATE_PHRASE: Record<string, string> = {
  draft: "en borrador",
  scheduled: "programada",
  sending: "enviándose",
  paused: "en pausa",
  completed: "terminada",
  cancelled: "cancelada",
};

async function readStatus(db: Db, workspaceId: string, broadcastId: string): Promise<{ status: BroadcastStatus } | null | "error"> {
  const { data, error } = await db
    .from("broadcasts")
    .select("status")
    .eq("id", broadcastId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[broadcasts/control] leer estado", error.message);
    return "error";
  }
  return data ? { status: data.status as BroadcastStatus } : null;
}

/** Cuántos destinatarios hay en cada estado (una consulta de conteo por estado). */
export async function loadBroadcastProgress(db: Db, broadcastId: string): Promise<BroadcastProgress | null> {
  const results = await Promise.all(
    RECIPIENT_STATUSES.map(async (status) => {
      const { count, error } = await db
        .from("broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("broadcast_id", broadcastId)
        .eq("status", status);
      return { status, count: count ?? 0, error };
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error("[broadcasts/control] contar destinatarios", failed.error);
    return null;
  }
  const counts: Partial<Record<RecipientStatus, number>> = {};
  for (const r of results) counts[r.status] = r.count;
  return progressFromCounts(counts);
}

function auditMeta(broadcastId: string, p: BroadcastProgress) {
  return { broadcast_id: broadcastId, sent: p.sent, pending: p.pending, in_flight: p.sending, failed: p.failed, skipped: p.skipped, cancelled: p.cancelled };
}

async function finish(
  db: Db,
  params: ControlParams,
  action: "broadcast_paused" | "broadcast_resumed" | "broadcast_cancelled",
  status: BroadcastStatus,
  changed: boolean,
): Promise<ControlOutcome> {
  const progress = await loadBroadcastProgress(db, params.broadcastId);
  if (!progress) return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  // Solo deja registro lo que de verdad cambió (quién, cuándo —lo pone la base— y cuántos enviados y pendientes).
  if (changed) {
    await logAudit(db, {
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      action,
      entity: "broadcast",
      meta: auditMeta(params.broadcastId, progress),
    });
  }
  return { ok: true, changed, status, progress };
}

function refuse(status: BroadcastStatus, verb: string): ControlOutcome {
  return { ok: false, status: 409, error: `No se puede ${verb} una difusión ${STATE_PHRASE[status] ?? status}.` };
}

/** Pausa: deja de enviar en la siguiente pasada del cron (como mucho un minuto). */
export async function pauseBroadcast(db: Db, params: ControlParams): Promise<ControlOutcome> {
  const { data: changed, error } = await db
    .from("broadcasts")
    .update({ status: "paused", paused_at: new Date().toISOString(), paused_reason: "manual", pause_note: null })
    .eq("id", params.broadcastId)
    .eq("workspace_id", params.workspaceId)
    .eq("status", "sending")
    .select("id");
  if (error) {
    console.error("[broadcasts/control] pausar", error.message);
    return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  }
  if (changed && changed.length > 0) return finish(db, params, "broadcast_paused", "paused", true);

  const current = await readStatus(db, params.workspaceId, params.broadcastId);
  if (current === "error") return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  if (!current) return { ok: false, status: 404, error: BROADCAST_NOT_FOUND_MESSAGE };
  if (current.status === "paused") return finish(db, params, "broadcast_paused", "paused", false);
  return refuse(current.status, "pausar");
}

/** Reanuda: sigue con los pendientes. Quien ya recibió el mensaje no lo recibe otra vez. */
export async function resumeBroadcast(db: Db, params: ControlParams): Promise<ControlOutcome> {
  const { data: changed, error } = await db
    .from("broadcasts")
    .update({ status: "sending", paused_at: null, paused_reason: null, pause_note: null, consecutive_failures: 0 })
    .eq("id", params.broadcastId)
    .eq("workspace_id", params.workspaceId)
    .eq("status", "paused")
    .select("id");
  if (error) {
    console.error("[broadcasts/control] reanudar", error.message);
    return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  }
  if (changed && changed.length > 0) {
    // Si en la pausa ya no quedaba nada por enviar, la difusión termina en vez de quedar "enviándose" sin trabajo.
    const progress = await loadBroadcastProgress(db, params.broadcastId);
    if (progress && waitingCount(progress) === 0) {
      await db
        .from("broadcasts")
        .update({ status: "completed" })
        .eq("id", params.broadcastId)
        .eq("workspace_id", params.workspaceId)
        .eq("status", "sending");
      return finish(db, params, "broadcast_resumed", "completed", true);
    }
    return finish(db, params, "broadcast_resumed", "sending", true);
  }

  const current = await readStatus(db, params.workspaceId, params.broadcastId);
  if (current === "error") return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  if (!current) return { ok: false, status: 404, error: BROADCAST_NOT_FOUND_MESSAGE };
  if (current.status === "sending") return finish(db, params, "broadcast_resumed", "sending", false);
  if (current.status === "cancelled") {
    return { ok: false, status: 409, error: "Una difusión cancelada no se puede reanudar. Crea una difusión nueva." };
  }
  if (current.status === "completed") return { ok: false, status: 409, error: "Esta difusión ya terminó: no queda nada por reanudar." };
  return { ok: false, status: 409, error: "Esta difusión todavía no se envió." };
}

/** Cancela: los pendientes quedan como «cancelado» (no «fallido») y no se puede reanudar. */
export async function cancelBroadcast(db: Db, params: ControlParams): Promise<ControlOutcome> {
  const { data: changed, error } = await db
    .from("broadcasts")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", params.broadcastId)
    .eq("workspace_id", params.workspaceId)
    .in("status", ["sending", "paused", "scheduled"])
    .select("id");
  if (error) {
    console.error("[broadcasts/control] cancelar", error.message);
    return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  }
  const didChange = !!changed && changed.length > 0;

  if (!didChange) {
    const current = await readStatus(db, params.workspaceId, params.broadcastId);
    if (current === "error") return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
    if (!current) return { ok: false, status: 404, error: BROADCAST_NOT_FOUND_MESSAGE };
    // Ya estaba cancelada: se repite el barrido de pendientes por si el intento anterior se cortó a la mitad.
    if (current.status !== "cancelled") return refuse(current.status, "cancelar");
  }

  // Solo los que siguen pendientes: a quien el cron ya tomó se le deja terminar.
  const sweep = await db
    .from("broadcast_recipients")
    .update({ status: "cancelled", error_message: BROADCAST_CANCELLED_RECIPIENT_MESSAGE })
    .eq("broadcast_id", params.broadcastId)
    .eq("status", "pending");
  if (sweep.error) {
    // La difusión ya no envía (su estado es «cancelada»); quedan pendientes sin marcar. Repetir «Cancelar» termina el barrido.
    console.error("[broadcasts/control] cancelar pendientes", sweep.error.message);
    return { ok: false, status: 500, error: BROADCAST_CONTROL_FAILED_MESSAGE };
  }
  // Trabajos de envío que pudieran quedar de versiones anteriores (ya no se crean).
  await db.from("scheduled_jobs").delete().eq("type", "send_broadcast").eq("status", "pending").eq("payload->>broadcastId", params.broadcastId);

  return finish(db, params, "broadcast_cancelled", "cancelled", didChange);
}
