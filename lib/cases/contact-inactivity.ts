// Inactividad automática (tanda 9): una vez al día por espacio, los contactos
// cuya última venta ganada es de hace más de N días pasan al tipo elegido
// (por defecto "Inactivo", 90 días). Lo llama runCaseTasks (cron cada minuto).
//
// - Solo cuenta la última gestión GANADA (closed_at). Quien nunca compró no se
//   toca (un prospecto no está "inactivo": nunca fue cliente).
// - Idempotente: quien ya tiene el tipo de inactividad no se vuelve a mover, y
//   quien compró de nuevo (otra venta ganada dentro del plazo) queda fuera.
//   Una pasada repetida el mismo día no cambia nada.
// - Una persona que corrigió el tipo a mano dentro del plazo no se revierte
//   (ver canMakeInactive).
// - Un cliente con una gestión activa (abierta o programada, ACTIVE_CASE_STATUSES)
//   no pasa a inactivo: se le está atendiendo, o tiene una recompra por venir.
//   No se guarda ninguna marca: la exclusión se evalúa en cada pasada diaria, así
//   que al cerrarse la gestión (ganada, perdida, cancelada) el contacto vuelve a
//   ser candidato en la siguiente pasada. Los N días se cuentan siempre desde la
//   última venta ganada (la última actividad real), no desde que se cerró la gestión.
// - Cada cambio queda en el historial con source 'inactividad' y se ve en el
//   chat como línea de sistema.
// - "Una vez al día": settings.contact_type_inactivity_run = { day, cursor }.
//   Con day = hoy (Lima) y cursor null la pasada ya terminó; si el tiempo se
//   agotó a mitad de camino, `cursor` es la última gestión revisada y la
//   siguiente vuelta continúa desde ahí.
//
// Cuando un contacto inactivo vuelve a ganar una venta, las reglas de cierre
// ("Cliente" / "Cliente frecuente desde la 2.ª") lo devuelven: gana la regla
// más específica según el total de ventas ganadas (rules.ts, planRules), sin
// importar su tipo anterior, salvo que una regla pida un tipo de contacto
// concreto en su condición.

import { ACTIVE_CASE_STATUSES } from "@/lib/permissions";
import { mergeWorkspaceSettings } from "@/lib/workspace-settings";
import { limaDateOf } from "./dates";
import type { Db } from "./io";
import { recordContactTypeChange, setContactTypeRow } from "./contact-type";
import {
  INACTIVITY_RUN_KEY,
  INACTIVITY_SETTINGS_KEY,
  canMakeInactive,
  daysBetween,
  inactivityCutoff,
  inactivityReasonText,
  parseInactivitySettings,
} from "./contact-type-model";

const PAGE = 200;

export interface InactivityStats {
  /** Contactos que pasaron al tipo de inactividad en esta vuelta. */
  moved: number;
  /** Espacios que tenían la función encendida y se revisaron. */
  workspaces: number;
  stoppedEarly: boolean;
}

interface RunState {
  day: string | null;
  cursor: string | null;
}

function runState(settings: unknown): RunState {
  const raw = (settings as Record<string, unknown> | null | undefined)?.[INACTIVITY_RUN_KEY];
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    day: typeof r.day === "string" ? r.day : null,
    cursor: typeof r.cursor === "string" ? r.cursor : null,
  };
}

async function saveRunState(db: Db, workspaceId: string, current: unknown, state: RunState): Promise<void> {
  const base = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  const error = await mergeWorkspaceSettings(db, workspaceId, base, { ...base, [INACTIVITY_RUN_KEY]: state });
  if (error) console.error("[contact-inactivity] run state", error);
}

/** Contactos (de la lista) con al menos una gestión abierta o programada. */
async function contactsWithActiveCase(db: Db, workspaceId: string, contactIds: string[]): Promise<Set<string>> {
  const { data } = await db
    .from("cases")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .in("status", [...ACTIVE_CASE_STATUSES])
    .in("contact_id", contactIds);
  return new Set((data ?? []).map((c) => c.contact_id));
}

/**
 * Pasa a inactivos a los contactos de UN espacio. Devuelve cuántos movió y el
 * cursor para seguir (null = terminó).
 */
export async function applyInactivityForWorkspace(
  db: Db,
  params: {
    workspaceId: string;
    typeId: string;
    days: number;
    now: Date;
    deadline: number;
    cursor?: string | null;
  },
): Promise<{ moved: number; cursor: string | null }> {
  const { workspaceId, typeId, days, now } = params;
  const cutoff = inactivityCutoff(now, days);

  // El tipo destino debe existir y estar activo; si no, no se hace nada.
  const { data: target } = await db
    .from("contact_types")
    .select("id")
    .eq("id", typeId)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .maybeSingle();
  if (!target) return { moved: 0, cursor: null };

  let moved = 0;
  let cursor = params.cursor ?? null;
  for (;;) {
    if (Date.now() >= params.deadline) return { moved, cursor };

    // Ventas ganadas anteriores al corte, de a una página por id (sin repetir).
    let q = db
      .from("cases")
      .select("id, contact_id, closed_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "won")
      .lte("closed_at", cutoff)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt("id", cursor);
    const { data: oldWins } = await q;
    const page = oldWins ?? [];
    if (page.length === 0) return { moved, cursor: null };
    const lastId = page[page.length - 1].id;

    const contactIds = [...new Set(page.map((c) => c.contact_id))];
    // Quienes compraron de nuevo dentro del plazo no están inactivos.
    const { data: recent } = await db
      .from("cases")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "won")
      .gt("closed_at", cutoff)
      .in("contact_id", contactIds);
    const buyingAgain = new Set((recent ?? []).map((c) => c.contact_id));
    const candidates = contactIds.filter((id) => !buyingAgain.has(id));
    if (candidates.length > 0) {
      // Última venta de cada uno (todas son anteriores al corte: ninguna reciente).
      const { data: wins } = await db
        .from("cases")
        .select("contact_id, closed_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "won")
        .in("contact_id", candidates);
      const lastWin = new Map<string, string>();
      for (const c of wins ?? []) {
        if (!c.closed_at) continue;
        const prev = lastWin.get(c.contact_id);
        if (!prev || c.closed_at > prev) lastWin.set(c.contact_id, c.closed_at);
      }
      const { data: contacts } = await db
        .from("contacts")
        .select("id, contact_type_id, contact_type_confirmed_at, contact_type_confirmed_by")
        .eq("workspace_id", workspaceId)
        .in("id", candidates);
      // Gestión abierta o programada: no se les pasa a inactivos (una consulta por lote).
      const withActive = await contactsWithActiveCase(db, workspaceId, candidates);
      for (const contact of contacts ?? []) {
        if (!canMakeInactive(contact, typeId, cutoff)) continue;
        if (withActive.has(contact.id)) continue;
        // Reconfirmación justo antes de mover (solo a quien va a cambiar, son pocos):
        // si una gestión se abrió durante esta pasada, no se le pasa a inactivo.
        if ((await contactsWithActiveCase(db, workspaceId, [contact.id])).size > 0) continue;
        const res = await setContactTypeRow(db, {
          workspaceId,
          contactId: contact.id,
          contactTypeId: typeId,
          // Si otro proceso lo cambió mientras tanto, no se pisa.
          onlyIfCurrent: contact.contact_type_id,
        });
        if (!res.ok || !res.changed) continue;
        const last = lastWin.get(contact.id) ?? cutoff;
        await recordContactTypeChange(db, {
          workspaceId,
          contactId: contact.id,
          actorId: null,
          from: contact.contact_type_id,
          to: typeId,
          source: "inactividad",
          reason: inactivityReasonText(daysBetween(last, now)),
        });
        moved++;
      }
    }

    cursor = lastId;
    if (page.length < PAGE) return { moved, cursor: null };
  }
}

/** Revisa los espacios con la función encendida, una vez al día cada uno. */
export async function runContactInactivity(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<InactivityStats> {
  const now = opts.now ?? new Date();
  const today = limaDateOf(now);
  const stats: InactivityStats = { moved: 0, workspaces: 0, stoppedEarly: false };

  const { data: workspaces, error } = await db.from("workspaces").select("id, settings");
  if (error) {
    console.error("[contact-inactivity] workspaces", error.message);
    return stats;
  }
  for (const ws of workspaces ?? []) {
    const settings = parseInactivitySettings(ws.settings);
    if (!settings.enabled || !settings.typeId) continue;
    const state = runState(ws.settings);
    // Ya terminó hoy.
    if (state.day === today && state.cursor === null) continue;
    if (Date.now() >= opts.deadline) {
      stats.stoppedEarly = true;
      break;
    }
    stats.workspaces++;
    const result = await applyInactivityForWorkspace(db, {
      workspaceId: ws.id,
      typeId: settings.typeId,
      days: settings.days,
      now,
      deadline: opts.deadline,
      cursor: state.day === today ? state.cursor : null,
    });
    stats.moved += result.moved;
    if (result.cursor !== null) stats.stoppedEarly = true;
    await saveRunState(db, ws.id, ws.settings, { day: today, cursor: result.cursor });
  }
  return stats;
}

export { INACTIVITY_SETTINGS_KEY };
