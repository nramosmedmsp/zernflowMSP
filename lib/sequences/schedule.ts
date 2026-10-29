// Horario de atención que rige las secuencias: el de la empresa y sus feriados.

import { buildHoursInfo, loadHolidayRows, scheduleForTeam } from "@/lib/cases/hours";
import type { Db } from "@/lib/cases/io";
import type { StepSchedule } from "./steps";

/** Nunca lanza: si no se puede leer el horario, se trabaja sin horario (24 horas). */
export async function loadStepSchedule(db: Db, workspaceId: string): Promise<StepSchedule | null> {
  try {
    const [{ data: ws }, holidays] = await Promise.all([
      db.from("workspaces").select("name, settings").eq("id", workspaceId).maybeSingle(),
      loadHolidayRows(db, workspaceId),
    ]);
    const info = buildHoursInfo({ workspace: ws, teams: [], holidays });
    const s = scheduleForTeam(info, null);
    return s.hours ? { hours: s.hours, holidays: s.holidays } : null;
  } catch (err) {
    console.error("[sequences] horario", err);
    return null;
  }
}
