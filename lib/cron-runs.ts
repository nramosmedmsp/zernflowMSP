// Señal de vida de las tareas automáticas (OPE-01 / CONF-08). Cada cron anota su
// última ejecución en cron_runs (00041); /api/health y Configuración > Estado
// del sistema la leen. Anotar nunca debe romper la tarea: si la tabla no existe
// aún (migración pendiente) o la base falla, solo se registra el error.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const CRON_NAMES = ["jobs", "sequences", "media_cleanup"] as const;
export type CronName = (typeof CRON_NAMES)[number];

/** Una tarea de cada minuto se considera caída pasados 5 minutos sin terminar bien. */
export const CRON_STALE_MS: Record<CronName, number> = {
  jobs: 5 * 60_000,
  sequences: 5 * 60_000,
  // Corre una vez al día: no entra en /api/health; esto solo marca el aviso en Configuración.
  media_cleanup: 36 * 60 * 60_000,
};

export async function recordCronStart(db: Db, name: CronName, now: Date = new Date()): Promise<void> {
  try {
    const iso = now.toISOString();
    const { error } = await db
      .from("cron_runs")
      .upsert({ name, last_started_at: iso, updated_at: iso }, { onConflict: "name" });
    if (error) console.error(`[cron_runs] inicio de ${name}:`, error.message);
  } catch (err) {
    console.error(`[cron_runs] inicio de ${name}:`, err);
  }
}

/** Fin de la pasada: `error` null = terminó bien. `stats` son solo conteos (sin datos de personas). */
export async function recordCronEnd(
  db: Db,
  name: CronName,
  result: { startedAt: number; error?: string | null; stats?: Record<string, unknown> | null },
): Promise<void> {
  try {
    const now = new Date();
    const iso = now.toISOString();
    const patch: Database["public"]["Tables"]["cron_runs"]["Update"] = {
      last_duration_ms: Math.max(0, now.getTime() - result.startedAt),
      last_stats: (result.stats ?? null) as Json | null,
      updated_at: iso,
    };
    if (result.error) {
      patch.last_error_at = iso;
      patch.last_error = result.error.slice(0, 300);
    } else {
      patch.last_ok_at = iso;
    }
    const { error } = await db.from("cron_runs").upsert({ name, ...patch }, { onConflict: "name" });
    if (error) console.error(`[cron_runs] fin de ${name}:`, error.message);
  } catch (err) {
    console.error(`[cron_runs] fin de ${name}:`, err);
  }
}

export interface CronRunRow {
  name: string;
  last_started_at: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
}

/** ¿Corrió bien hace menos de `maxAgeMs`? Sin fila o sin éxito registrado: no. */
export function isCronFresh(row: Pick<CronRunRow, "last_ok_at"> | undefined | null, maxAgeMs: number, now: number = Date.now()): boolean {
  if (!row?.last_ok_at) return false;
  const t = new Date(row.last_ok_at).getTime();
  return Number.isFinite(t) && now - t <= maxAgeMs;
}
