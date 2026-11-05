// Tipo de contacto: operaciones con la base (historial, confirmación y lectura
// para la ficha y el chat). Siempre con el cliente de servicio, después de que
// quien llama validó permisos (lib/actions/contacts.ts, el motor o el cron).
//
// El historial reutiliza `activity` (type = 'contact_type_changed'): ya guarda
// de/a, quién (actor_id, null = automático) y cuándo; el origen y el motivo
// van en `meta` ({ source, reason_text }). `meta.reason` conserva el valor de
// antes ('manual' | 'rule' | 'default') para lo que ya lo lee.

import { logActivity, type Db } from "./io";
import {
  toTypeChange,
  visibleChanges,
  type ContactTypeInfo,
  type ContactTypeSource,
  type TypeChange,
} from "./contact-type-model";

const LEGACY_REASON: Record<ContactTypeSource, string> = {
  manual: "manual",
  rule: "rule",
  sistema: "default",
  inactividad: "inactividad",
  import: "import",
};

export interface TypeChangeRecord {
  workspaceId: string;
  contactId: string;
  caseId?: string | null;
  /** Quién lo hizo; null = automático (regla, inactividad, sistema). */
  actorId: string | null;
  from: string | null;
  to: string | null;
  source: ContactTypeSource;
  /** Texto legible del motivo, sin paréntesis ("2.ª compra ganada"). */
  reason: string | null;
  /** Persona que provocó un cambio automático (p. ej. quien cerró la venta). */
  triggeredBy?: string | null;
}

function toActivity(input: TypeChangeRecord) {
  return {
    workspace_id: input.workspaceId,
    type: "contact_type_changed" as const,
    contact_id: input.contactId,
    case_id: input.caseId ?? null,
    actor_id: input.actorId,
    from_value: input.from,
    to_value: input.to,
    meta: {
      reason: LEGACY_REASON[input.source],
      source: input.source,
      ...(input.reason ? { reason_text: input.reason } : {}),
      ...(input.triggeredBy ? { triggered_by: input.triggeredBy } : {}),
    },
  };
}

/** Anota un cambio de tipo en el historial. Un fallo se registra en el log y no corta la operación. */
export async function recordContactTypeChange(db: Db, input: TypeChangeRecord): Promise<void> {
  await logActivity(db, toActivity(input));
}

/** Varios cambios de una vez (importación, cambios en bloque). */
export async function recordContactTypeChanges(db: Db, inputs: readonly TypeChangeRecord[]): Promise<void> {
  await logActivity(db, inputs.map(toActivity));
}

/** Confirma el tipo de varios contactos a la vez (importación con tipo explícito). */
export async function confirmContactTypesRows(
  db: Db,
  params: { workspaceId: string; contactIds: readonly string[]; by: string | null; at: string },
): Promise<void> {
  if (params.contactIds.length === 0) return;
  const { error } = await db
    .from("contacts")
    .update({ contact_type_confirmed_at: params.at, contact_type_confirmed_by: params.by })
    .eq("workspace_id", params.workspaceId)
    .in("id", [...params.contactIds]);
  if (error && !isMissingColumn(error)) console.error("[contact-type] confirm bulk", error.message);
}

/** La base no tiene las columnas de 00036 (el código se desplegó antes que la migración). */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /contact_type_(confirmed|prompt)|column .* does not exist/i.test(error.message ?? "")
  );
}

/**
 * Cambia el tipo del contacto y, si `confirm` trae datos, lo marca como
 * confirmado en la misma instrucción. Sin las columnas de 00036 reintenta sin
 * ellas: el cambio de tipo sigue funcionando aunque la migración falte.
 */
export async function setContactTypeRow(
  db: Db,
  params: {
    workspaceId: string;
    contactId: string;
    contactTypeId: string | null;
    confirm?: { at: string; by: string | null } | null;
    /** Solo si el contacto sigue con este tipo (evita pisar un cambio simultáneo). */
    onlyIfCurrent?: string | null;
  },
): Promise<{ ok: boolean; changed: boolean }> {
  const patch: Record<string, unknown> = { contact_type_id: params.contactTypeId };
  if (params.confirm) {
    patch.contact_type_confirmed_at = params.confirm.at;
    patch.contact_type_confirmed_by = params.confirm.by;
    patch.contact_type_prompt_snoozed_until = null;
  }
  const run = async (body: Record<string, unknown>) => {
    let q = db.from("contacts").update(body).eq("id", params.contactId).eq("workspace_id", params.workspaceId);
    if (params.onlyIfCurrent !== undefined) {
      q = params.onlyIfCurrent === null ? q.is("contact_type_id", null) : q.eq("contact_type_id", params.onlyIfCurrent);
    }
    return q.select("id");
  };
  let res = await run(patch);
  if (res.error && params.confirm && isMissingColumn(res.error)) {
    console.error("[contact-type] falta la migración 00036; se cambia el tipo sin confirmarlo");
    res = await run({ contact_type_id: params.contactTypeId });
  }
  if (res.error) {
    console.error("[contact-type] update", res.error.message);
    return { ok: false, changed: false };
  }
  return { ok: true, changed: (res.data ?? []).length > 0 };
}

/** Marca el tipo como confirmado (sin cambiarlo). Una persona lo hizo: `by`. */
export async function confirmContactTypeRow(
  db: Db,
  params: { workspaceId: string; contactId: string; by: string | null; at: string },
): Promise<boolean> {
  const { error } = await db
    .from("contacts")
    .update({
      contact_type_confirmed_at: params.at,
      contact_type_confirmed_by: params.by,
      contact_type_prompt_snoozed_until: null,
    })
    .eq("id", params.contactId)
    .eq("workspace_id", params.workspaceId);
  if (error) {
    console.error("[contact-type] confirm", error.message);
    return false;
  }
  return true;
}

const HISTORY_LIMIT = 30;

/**
 * Lo que la ficha y el chat necesitan del tipo de un contacto: confirmación,
 * "Preguntar después", si ya compró y los últimos cambios. Tolera la ausencia
 * de las columnas de 00036 (devuelve "sin confirmar").
 */
export async function loadContactTypeInfo(
  db: Db,
  contactId: string,
  contact?: {
    contact_type_confirmed_at?: string | null;
    contact_type_confirmed_by?: string | null;
    contact_type_prompt_snoozed_until?: string | null;
  } | null,
): Promise<ContactTypeInfo> {
  const [{ data: changes }, { count }] = await Promise.all([
    db
      .from("activity")
      .select("id, created_at, case_id, actor_id, from_value, to_value, meta")
      .eq("contact_id", contactId)
      .eq("type", "contact_type_changed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_LIMIT),
    db.from("cases").select("id", { count: "exact", head: true }).eq("contact_id", contactId).eq("status", "won"),
  ]);
  const history: TypeChange[] = visibleChanges((changes ?? []).map((r) => toTypeChange(r)));
  return {
    confirmedAt: contact?.contact_type_confirmed_at ?? null,
    confirmedBy: contact?.contact_type_confirmed_by ?? null,
    snoozedUntil: contact?.contact_type_prompt_snoozed_until ?? null,
    hasWonCase: (count ?? 0) > 0,
    history,
  };
}
