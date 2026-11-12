// Comprobación de salud para /api/health (app/api/health/route.ts): base
// respondiendo y tareas automáticas al día. Una sola consulta liviana (2 filas
// de cron_runs) y el resultado se recuerda unos segundos, para que un monitor
// (o alguien insistiendo) no pueda usarla para cargar la base.

import { createServiceClient } from "@/lib/supabase/server";
import { CRON_STALE_MS, isCronFresh } from "@/lib/cron-runs";

const CACHE_MS = 10_000;
const DB_TIMEOUT_MS = 4_000;

export type HealthReason = "base" | "cron_jobs" | "cron_secuencias";
export type HealthResult = { ok: true } | { ok: false; reason: HealthReason };

let cached: { at: number; result: HealthResult } | null = null;
/** Comprobación en curso: las llamadas simultáneas la comparten en vez de consultar cada una. */
let inflight: Promise<HealthResult> | null = null;

/** Para las pruebas. */
export function resetHealthCache() {
  cached = null;
  inflight = null;
}

async function check(): Promise<HealthResult> {
  try {
    const db = await createServiceClient();
    const query = db.from("cron_runs").select("name, last_ok_at").in("name", ["jobs", "sequences"]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    let response;
    try {
      response = await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
    const { data, error } = response;
    if (error) {
      console.error("[health] la base no respondió bien:", error.message);
      return { ok: false, reason: "base" };
    }
    const rows = data ?? [];
    const now = Date.now();
    if (!isCronFresh(rows.find((r) => r.name === "jobs"), CRON_STALE_MS.jobs, now)) {
      return { ok: false, reason: "cron_jobs" };
    }
    if (!isCronFresh(rows.find((r) => r.name === "sequences"), CRON_STALE_MS.sequences, now)) {
      return { ok: false, reason: "cron_secuencias" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[health] error:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "base" };
  }
}

export async function getHealth(now: number = Date.now()): Promise<HealthResult> {
  if (cached && now - cached.at <= CACHE_MS) return cached.result;
  inflight ??= check()
    .then((result) => {
      cached = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
