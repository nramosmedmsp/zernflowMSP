// Lanzar una difusión: elegir destinatarios, crearlos y programar los envíos,
// sin que el mismo cliente reciba la promoción dos veces (A-9).
//
//  1. Se "reclama" la difusión con una sola actualización condicional
//     (borrador/programada -> enviándose). Quien llega segundo (doble clic, dos
//     pestañas, dos administradores) no la gana y recibe 409.
//  2. Con la difusión ya reclamada se crean los destinatarios y los trabajos.
//     La base impide además un destinatario repetido por difusión (00033).
//  3. Si algo falla a medias, se deshace lo creado y la difusión vuelve a su
//     estado anterior, para poder reintentar sin duplicar.

import type { Db } from "@/lib/cases/io";
import { scheduleBroadcastDelivery } from "@/lib/scheduler";
import type { Json } from "@/lib/types/database";
import type { ParsedBroadcastContent } from "./content";
import { planBroadcast, type BroadcastPlan } from "./plan";
import { describeExclusions } from "./request";
import type { SegmentFilter } from "./segment";

export const ALREADY_SENDING_MESSAGE = "Esta difusión ya se está enviando. Espera a que termine y revisa el detalle.";
export const LAUNCH_FAILED_MESSAGE =
  "No se pudo enviar la difusión y no salió ningún mensaje. Inténtalo de nuevo; si sigue fallando, avisa al administrador.";

export type LaunchResult =
  | {
      ok: true;
      totalRecipients: number;
      excluded: BroadcastPlan["excluded"];
      excludedTotal: number;
    }
  | { ok: false; status: number; error: string };

export interface LaunchParams {
  workspaceId: string;
  broadcastId: string;
  /** Estado en que se leyó la difusión (al que vuelve si el envío falla). */
  previousStatus: "draft" | "scheduled";
  content: ParsedBroadcastContent;
  /** Contenido que vino en la solicitud: se guarda junto con el reclamo. */
  overrideContent?: Record<string, unknown> | null;
  filter: SegmentFilter | null;
}

const BATCH = 500;

export async function launchBroadcast(db: Db, p: LaunchParams): Promise<LaunchResult> {
  let plan: BroadcastPlan;
  try {
    plan = await planBroadcast(db, p.workspaceId, p.content, p.filter);
  } catch (err) {
    console.error("[broadcasts/launch] plan", err);
    return { ok: false, status: 500, error: "No se pudieron elegir los destinatarios de la difusión" };
  }

  if (plan.segmentTotal === 0) {
    return { ok: false, status: 400, error: "Ningún contacto cumple el filtro de segmento" };
  }
  if (plan.recipients.length === 0) {
    const why = describeExclusions(plan.excluded);
    return {
      ok: false,
      status: 400,
      error:
        plan.kind === "text"
          ? `Ningún contacto puede recibir un texto ahora${why.length ? ` (${why.join("; ")})` : ""}. Fuera de las 24 horas solo se pueden enviar plantillas de WhatsApp.`
          : `Ningún contacto puede recibir la plantilla${why.length ? ` (${why.join("; ")})` : ""}.`,
    };
  }

  // 1. Reclamar la difusión. Una sola operación: solo una solicitud la gana.
  const { data: claimed, error: claimError } = await db
    .from("broadcasts")
    .update({
      status: "sending",
      total_recipients: plan.recipients.length,
      ...(p.overrideContent ? { message_content: p.content as unknown as Json } : {}),
    })
    .eq("id", p.broadcastId)
    .eq("workspace_id", p.workspaceId)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (claimError) {
    console.error("[broadcasts/launch] claim", claimError);
    return { ok: false, status: 500, error: LAUNCH_FAILED_MESSAGE };
  }
  if (!claimed || claimed.length === 0) {
    return { ok: false, status: 409, error: ALREADY_SENDING_MESSAGE };
  }

  // 2. Crear destinatarios y trabajos; ante cualquier fallo, deshacer.
  try {
    // Restos de un intento anterior que se cortó antes de esta corrección.
    await clearUnsent(db, p.broadcastId);

    const rows = plan.recipients.map((r) => ({
      broadcast_id: p.broadcastId,
      contact_id: r.contactId,
      channel_id: r.channelId,
      status: "pending",
    }));
    const recipientIds: string[] = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const { data: inserted, error } = await db.from("broadcast_recipients").insert(rows.slice(i, i + BATCH)).select("id");
      if (error) throw new Error(`recipients: ${error.message}`);
      recipientIds.push(...(inserted ?? []).map((r) => r.id));
    }
    if (recipientIds.length !== rows.length) throw new Error("recipients: no se crearon todos");

    await scheduleBroadcastDelivery(db, p.broadcastId, recipientIds);
  } catch (err) {
    console.error("[broadcasts/launch] fallo, se deshace", err);
    await rollback(db, p);
    return { ok: false, status: 500, error: LAUNCH_FAILED_MESSAGE };
  }

  return {
    ok: true,
    totalRecipients: plan.recipients.length,
    excluded: plan.excluded,
    excludedTotal: plan.segmentTotal - plan.recipients.length,
  };
}

/** Borra los destinatarios aún sin enviar de la difusión y sus trabajos programados. */
async function clearUnsent(db: Db, broadcastId: string): Promise<void> {
  const jobs = await db.from("scheduled_jobs").delete().eq("type", "send_broadcast").eq("payload->>broadcastId", broadcastId);
  if (jobs.error) throw new Error(`jobs: ${jobs.error.message}`);
  const recipients = await db.from("broadcast_recipients").delete().eq("broadcast_id", broadcastId).eq("status", "pending");
  if (recipients.error) throw new Error(`recipients: ${recipients.error.message}`);
}

async function rollback(db: Db, p: LaunchParams): Promise<void> {
  try {
    await clearUnsent(db, p.broadcastId);
    const { error } = await db
      .from("broadcasts")
      .update({ status: p.previousStatus, total_recipients: 0 })
      .eq("id", p.broadcastId)
      .eq("status", "sending");
    if (error) console.error("[broadcasts/launch] no se pudo devolver la difusión a su estado", error.message);
  } catch (err) {
    console.error("[broadcasts/launch] rollback", err);
  }
}
