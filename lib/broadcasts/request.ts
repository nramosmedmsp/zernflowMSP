// Parte común de la vista previa y el envío de una difusión: leer la difusión
// (de este espacio y todavía enviable), tomar el contenido del cuerpo de la
// solicitud si viene, y validarlo.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseBroadcastContent, type ParsedBroadcastContent } from "./content";
import type { SegmentFilter } from "./segment";

type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

// Etiquetas en español de los estados de difusión que se muestran en los errores.
export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  completed: "Completada",
  cancelled: "Cancelada",
};

export type LoadedBroadcast =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      broadcast: BroadcastRow;
      content: ParsedBroadcastContent;
      /** Contenido que vino en la solicitud (para guardarlo), si vino. */
      overrideContent: Record<string, unknown> | null;
      filter: SegmentFilter | null;
    };

export async function loadBroadcastForPlan(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  broadcastId: string,
  body: unknown,
): Promise<LoadedBroadcast> {
  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!broadcast) return { ok: false, status: 404, error: "No se encontró la difusión" };

  if (broadcast.status !== "draft" && broadcast.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: `No se puede enviar una difusión con estado "${BROADCAST_STATUS_LABELS[broadcast.status] ?? broadcast.status}"`,
    };
  }

  const override =
    body && typeof body === "object" && (body as { messageContent?: unknown }).messageContent
      ? ((body as { messageContent: unknown }).messageContent as Record<string, unknown>)
      : null;

  const content = parseBroadcastContent(override ?? broadcast.message_content);
  if (!content) {
    const raw = (override ?? broadcast.message_content) as { kind?: unknown } | null;
    return {
      ok: false,
      status: 400,
      error:
        raw && raw.kind === "template"
          ? "Elige una plantilla aprobada y su idioma para la difusión."
          : "El contenido del mensaje es obligatorio. Escribe el texto de la difusión.",
    };
  }

  return {
    ok: true,
    broadcast,
    content,
    overrideContent: override,
    filter: (broadcast.segment_filter as unknown as SegmentFilter | null) ?? null,
  };
}

/** Texto en español con el resultado de la selección, para los errores y la vista previa. */
export function describeExclusions(excluded: {
  noConversation: number;
  closedWindow: number;
  noPhone: number;
  emptyVariable: number;
}): string[] {
  const parts: string[] = [];
  if (excluded.closedWindow > 0) parts.push(`${excluded.closedWindow} con la ventana de 24 horas cerrada`);
  if (excluded.noConversation > 0) parts.push(`${excluded.noConversation} sin conversación en un canal activo`);
  if (excluded.noPhone > 0) parts.push(`${excluded.noPhone} sin teléfono de WhatsApp`);
  if (excluded.emptyVariable > 0) parts.push(`${excluded.emptyVariable} con una variable vacía`);
  return parts;
}
