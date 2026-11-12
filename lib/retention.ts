// Limpieza automática de datos viejos (BD-9 / PRIV-11), por decisión del dueño.
//
// SE BORRA SOLO (y nada más):
//   1. Notificaciones que la persona ya leyó hace más de 90 días.
//   2. Registros técnicos internos con más de 90 días: trabajos programados ya
//      terminados (completados o fallidos). Los pendientes y los "procesando" no.
//
// NUNCA se borra solo: chats, mensajes, gestiones, notas, contactos, el
// historial `activity` (es el registro de auditoría), las sesiones de "Ver
// como", los eventos de analítica (los usa Analítica), los registros de
// comentarios ni las sesiones de flujos (llevan datos de clientes): quedan "por
// decidir" con el dueño. `webhook_events` ya la poda el cron de trabajos.
//
// Borra por lotes con un tope por pasada: si hay más, sigue la pasada de mañana.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Plazo de las notificaciones ya leídas. */
export const NOTIFICATIONS_READ_RETENTION_DAYS = 90;
/** Plazo de los registros técnicos internos. */
export const TECHNICAL_LOG_RETENTION_DAYS = 90;
/** Filas por lote. */
export const RETENTION_BATCH_SIZE = 500;
/** Lotes máximos por tabla en una pasada (tope de 10 000 filas por tabla y día). */
export const RETENTION_MAX_BATCHES = 20;

export interface RetentionRule {
  table: "notifications" | "scheduled_jobs";
  /** Texto para el informe. */
  label: string;
  days: number;
  /** Columna de fecha que se compara con el plazo. */
  dateColumn: "read_at" | "created_at";
  /** Filtros extra que acotan lo que SÍ se puede borrar. */
  restrict: (q: LooseQuery) => LooseQuery;
}

/** Lo mínimo del constructor de consultas que usamos (permite probar sin base). */
export interface LooseQuery {
  not(column: string, op: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  lt(column: string, value: string): LooseQuery;
  order(column: string, opts?: { ascending?: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
}

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    table: "notifications",
    label: "Notificaciones leídas hace más de 90 días",
    days: NOTIFICATIONS_READ_RETENTION_DAYS,
    dateColumn: "read_at",
    // read_at nulo = sin leer: nunca se borra (la comparación con la fecha ya lo excluye; se deja explícito).
    restrict: (q) => q.not("read_at", "is", null),
  },
  {
    table: "scheduled_jobs",
    label: "Trabajos programados ya terminados (completados o fallidos) con más de 90 días",
    days: TECHNICAL_LOG_RETENTION_DAYS,
    dateColumn: "created_at",
    restrict: (q) => q.in("status", ["completed", "failed"]),
  },
];

/** Fecha límite: lo anterior a ella se puede borrar. Exactamente `days` días antes de `now`. */
export function retentionCutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export interface RetentionResult {
  deleted: Record<string, number>;
  /** Alguna tabla llegó al tope de la pasada: queda trabajo para mañana. */
  capped: boolean;
  errors: string[];
}

type AnyDb = SupabaseClient<never, never, never> | SupabaseClient;

/** Una pasada de limpieza. Un error en una tabla no impide limpiar la otra. */
export async function runRetention(
  db: AnyDb,
  now: Date = new Date(),
  rules: readonly RetentionRule[] = RETENTION_RULES,
): Promise<RetentionResult> {
  const result: RetentionResult = { deleted: {}, capped: false, errors: [] };
  // El constructor tipado de Supabase no admite tablas elegidas en ejecución: se usa por su forma mínima.
  const loose = db as unknown as {
    from(table: string): {
      select(columns: string): LooseQuery & PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
      delete(): { in(column: string, values: readonly string[]): PromiseLike<{ error: { message: string } | null }> };
    };
  };

  for (const rule of rules) {
    const cutoff = retentionCutoffIso(now, rule.days);
    result.deleted[rule.table] = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      const selected = rule
        .restrict(loose.from(rule.table).select("id"))
        .lt(rule.dateColumn, cutoff)
        .order(rule.dateColumn, { ascending: true })
        .limit(RETENTION_BATCH_SIZE) as unknown as PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
      const { data, error } = await selected;
      if (error) {
        result.errors.push(`${rule.table}: ${error.message}`);
        break;
      }
      const ids = (data ?? []).map((r) => r.id);
      if (ids.length === 0) break;
      const { error: delError } = await loose.from(rule.table).delete().in("id", ids);
      if (delError) {
        result.errors.push(`${rule.table}: ${delError.message}`);
        break;
      }
      result.deleted[rule.table] += ids.length;
      if (ids.length < RETENTION_BATCH_SIZE) break;
      if (batch === RETENTION_MAX_BATCHES - 1) result.capped = true;
    }
  }
  return result;
}
