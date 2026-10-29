// Horario efectivo de las gestiones (docs/FASE-2-TECNICO.md 2): el del equipo
// si tiene uno; si no, el de la empresa (workspaces.settings.business_hours).
// Se carga junto con el contexto de reparto (assign.ts) y se reutiliza por
// espacio en el cron.

import {
  businessMinutesBetween,
  effectiveBusinessHours,
  holidayDatesFor,
  isWithinHours,
  nextOpening,
  parseBusinessHours,
  parseOffHoursReply,
  parseReassignAfterMinutes,
  type BusinessHours,
} from "@/lib/business-hours";
import type { Json, OffHoursReplySettings } from "@/lib/types/database";
import { addDays, limaDateOf } from "./dates";
import type { Db } from "./io";
import type { SolutionSchedules } from "./protection";

/** Feriados hacia atrás que se cargan (para medir esperas largas en minutos hábiles). */
const HOLIDAYS_LOOKBACK_DAYS = 120;

export interface HoursInfo {
  workspaceName: string;
  /** Horario de la empresa (null = 24 horas). */
  workspaceHours: BusinessHours | null;
  /** Horario propio de cada equipo activo (null = usa el de la empresa). */
  teamHours: Map<string, BusinessHours | null>;
  teamNames: Map<string, string>;
  holidays: { date: string; team_id: string | null }[];
  offHoursReply: OffHoursReplySettings | null;
  reassignAfterMinutes: number | null;
}

export interface TeamSchedule {
  hours: BusinessHours | null;
  holidays: Set<string>;
}

function settingsObject(settings: Json | null | undefined): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

/** Arma HoursInfo con lo ya leído de la base (lo usa loadAssignmentContext). */
export function buildHoursInfo(params: {
  workspace: { name?: string | null; settings?: Json | null } | null;
  teams: readonly { id: string; name?: string | null; business_hours?: Json | null }[];
  holidays: readonly { date: string; team_id: string | null }[];
}): HoursInfo {
  const settings = settingsObject(params.workspace?.settings);
  return {
    workspaceName: params.workspace?.name ?? "",
    workspaceHours: parseBusinessHours(settings.business_hours),
    teamHours: new Map(params.teams.map((t) => [t.id, parseBusinessHours(t.business_hours ?? null)])),
    teamNames: new Map(params.teams.map((t) => [t.id, t.name ?? ""])),
    holidays: params.holidays.map((h) => ({ date: h.date, team_id: h.team_id })),
    offHoursReply: parseOffHoursReply(settings.off_hours_reply),
    reassignAfterMinutes: parseReassignAfterMinutes(settings.reassign_after_minutes),
  };
}

/** Feriados vigentes del espacio (desde hace 120 días). */
export async function loadHolidayRows(db: Db, workspaceId: string, now: Date = new Date()) {
  const { data, error } = await db
    .from("holidays")
    .select("date, team_id")
    .eq("workspace_id", workspaceId)
    .gte("date", addDays(limaDateOf(now), -HOLIDAYS_LOOKBACK_DAYS));
  // Sin la migración 00021 la tabla no existe: se trabaja sin feriados.
  if (error) console.error("[cases] holidays", error.message);
  return data ?? [];
}

/**
 * Segundos hábiles entre dos instantes con el horario efectivo de la gestión
 * (el del equipo, o el de la empresa). Sin horario son los segundos de reloj.
 * Nunca lanza: ante un fallo de lectura devuelve los segundos de reloj.
 */
export async function businessSecondsBetween(
  db: Db,
  params: { workspaceId: string; teamId: string | null; from: string; to: string },
): Promise<number> {
  const clock = Math.max(0, Math.round((new Date(params.to).getTime() - new Date(params.from).getTime()) / 1000));
  try {
    const [{ data: ws }, { data: team }, holidays] = await Promise.all([
      db.from("workspaces").select("name, settings").eq("id", params.workspaceId).maybeSingle(),
      params.teamId
        ? db
            .from("teams")
            .select("id, name, business_hours")
            .eq("id", params.teamId)
            .eq("workspace_id", params.workspaceId)
            .is("archived_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      loadHolidayRows(db, params.workspaceId, new Date(params.to)),
    ]);
    const info = buildHoursInfo({ workspace: ws, teams: team ? [team] : [], holidays });
    const schedule = scheduleForTeam(info, params.teamId);
    const minutes = businessMinutesBetween(params.from, params.to, schedule.hours, schedule.holidays);
    return Math.min(clock, Math.max(0, Math.round(minutes * 60)));
  } catch (err) {
    console.error("[cases] business seconds", err);
    return clock;
  }
}

/** Horario y feriados que rigen para un equipo (o para la empresa si teamId es null o no está activo). */
export function scheduleForTeam(info: HoursInfo, teamId: string | null): TeamSchedule {
  const own = teamId && info.teamHours.has(teamId) ? info.teamHours.get(teamId) ?? null : null;
  const hours = effectiveBusinessHours(own, info.workspaceHours);
  const known = teamId && info.teamHours.has(teamId) ? teamId : null;
  return { hours, holidays: holidayDatesFor(info.holidays, known) };
}

/** ¿El equipo (o la empresa) atiende en ese instante? */
export function isOpenAt(info: HoursInfo, teamId: string | null, at: Date | string): boolean {
  const s = scheduleForTeam(info, teamId);
  return isWithinHours(at, s.hours, s.holidays);
}

/** Próxima apertura del equipo (o `at` si está abierto). */
export function nextOpeningFor(info: HoursInfo, teamId: string | null, at: Date | string): Date | null {
  const s = scheduleForTeam(info, teamId);
  return nextOpening(at, s.hours, s.holidays);
}

/**
 * Horarios del espacio para contar el plazo de la solución en horas hábiles
 * (R2-10). Serializable: la bandeja y la lista de Gestiones lo reciben tal
 * cual. Nunca lanza: ante un fallo devuelve null (se cuenta en horas de reloj).
 */
export async function loadSolutionSchedules(db: Db, workspaceId: string): Promise<SolutionSchedules | null> {
  try {
    const [{ data: ws }, { data: teams }, holidays] = await Promise.all([
      db.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      db.from("teams").select("id, name, business_hours").eq("workspace_id", workspaceId).is("archived_at", null),
      loadHolidayRows(db, workspaceId),
    ]);
    const info = buildHoursInfo({ workspace: ws ?? null, teams: teams ?? [], holidays });
    return {
      workspaceHours: info.workspaceHours,
      teamHours: Object.fromEntries(info.teamHours),
      holidays: info.holidays,
    };
  } catch (err) {
    console.error("[cases] solution schedules", err);
    return null;
  }
}
