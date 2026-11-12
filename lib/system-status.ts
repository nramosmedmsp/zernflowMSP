// Datos de "Configuración > Estado del sistema" (solo Dueño y Administrador):
// la última ejecución de cada tarea automática y los mensajes entrantes que no
// se pudieron procesar. cron_runs y webhook_events no se pueden leer con la
// sesión del usuario (RLS sin políticas): se leen con el cliente de servicio,
// después de comprobar el rol.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CRON_NAMES, CRON_STALE_MS, isCronFresh, type CronName, type CronRunRow } from "@/lib/cron-runs";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const CRON_LABELS: Record<CronName, string> = {
  jobs: "Trabajos programados (esperas de flujos, difusiones, gestiones)",
  sequences: "Secuencias",
  media_cleanup: "Limpieza de archivos vencidos",
  retention: "Limpieza de avisos leídos y registros técnicos viejos",
};

export interface CronStatus {
  name: CronName;
  label: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  /** Corrió bien dentro de su plazo. */
  fresh: boolean;
}

export interface FailedEvent {
  eventId: string;
  receivedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface SystemStatus {
  crons: CronStatus[];
  failedEvents: FailedEvent[];
  failedTotal: number;
  /** Eventos esperando su reintento automático. */
  pendingEvents: number;
}

export async function loadSystemStatus(db: Db, workspaceId: string, now: number = Date.now()): Promise<SystemStatus> {
  const { data: runs } = await db.from("cron_runs").select("*");
  const byName = new Map<string, CronRunRow>((runs ?? []).map((r) => [r.name, r]));
  const crons = CRON_NAMES.map((name) => {
    const row = byName.get(name);
    return {
      name,
      label: CRON_LABELS[name],
      lastOkAt: row?.last_ok_at ?? null,
      lastErrorAt: row?.last_error_at ?? null,
      lastError: row?.last_error ?? null,
      lastDurationMs: row?.last_duration_ms ?? null,
      fresh: isCronFresh(row, CRON_STALE_MS[name], now),
    };
  });

  // Los eventos van por canal; los canales son del espacio.
  const { data: channels } = await db.from("channels").select("id").eq("workspace_id", workspaceId);
  const channelIds = (channels ?? []).map((c) => c.id);
  if (channelIds.length === 0) return { crons, failedEvents: [], failedTotal: 0, pendingEvents: 0 };

  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [failed, pending] = await Promise.all([
    db
      .from("webhook_events")
      .select("event_id, received_at, attempts, last_error", { count: "exact" })
      .eq("status", "failed")
      .in("channel_id", channelIds)
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(5),
    db
      .from("webhook_events")
      .select("event_id", { count: "exact", head: true })
      .in("status", ["received", "stored"])
      .in("channel_id", channelIds),
  ]);

  return {
    crons,
    failedEvents: (failed.data ?? []).map((e) => ({
      eventId: e.event_id,
      receivedAt: e.received_at,
      attempts: e.attempts,
      lastError: e.last_error,
    })),
    failedTotal: failed.count ?? failed.data?.length ?? 0,
    pendingEvents: pending.count ?? 0,
  };
}
