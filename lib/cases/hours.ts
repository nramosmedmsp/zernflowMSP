// Horario efectivo de las gestiones (docs/FASE-2-TECNICO.md 2): el del equipo
// si tiene uno; si no, el de la empresa (workspaces.settings.business_hours).
// Se carga junto con el contexto de reparto (assign.ts) y se reutiliza por
// espacio en el cron.

import {
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
