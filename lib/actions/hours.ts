"use server";

// Acciones de servidor de Configuración → Horarios (docs/FASE-2-TECNICO.md 8).
// Todas validan, con getWorkspace(), que quien llama es Dueño o Administrador
// del espacio actual y que el equipo pertenece a ese espacio. Escriben con el
// cliente del usuario, de modo que RLS vuelve a exigir el rol. La validación
// del horario es la misma regla que `is_valid_business_hours` en la base.

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import {
  checkHolidayInput,
  checkHoursInput,
  isHolidayYear,
  mergeBusinessHoursSettings,
  missingPeruHolidays,
} from "@/components/settings/hours/hours-rules";
import type { Json } from "@/lib/types/database";

export type HoursActionResult<T extends object = object> = ({ ok: true } & T) | { error: string };

const WORKSPACE_CHANGED = "El espacio de trabajo cambió. Recarga la página e inténtalo de nuevo.";
const GENERIC_ERROR = "No se pudo guardar el cambio. Inténtalo de nuevo.";
const TEAM_NOT_FOUND = "No se encontró el equipo. Recarga la página e inténtalo de nuevo.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = "/dashboard/settings/hours";

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

interface Admin {
  error?: undefined;
  workspaceId: string;
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"];
}

async function adminContext(): Promise<Admin | { error: string }> {
  const { workspace, role, supabase } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  return { workspaceId: workspace.id, supabase };
}

/** Equipo del espacio actual (null si no existe o es de otro espacio). */
async function ownedTeam(ctx: Admin, teamId: unknown): Promise<{ id: string } | null> {
  if (!isId(teamId)) return null;
  const { data } = await ctx.supabase
    .from("teams")
    .select("id")
    .eq("id", teamId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  return data ?? null;
}

/** Horario de la empresa: sin tramos = 24 horas. Conserva las demás claves de settings. */
export async function saveCompanyHours(workspaceId: string, hours: unknown): Promise<HoursActionResult> {
  const ctx = await adminContext();
  if (ctx.error !== undefined) return { error: ctx.error };
  if (ctx.workspaceId !== workspaceId) return { error: WORKSPACE_CHANGED };

  const checked = checkHoursInput(hours, "company");
  if (!checked.ok) return { error: checked.error };

  const { data: current, error: readError } = await ctx.supabase
    .from("workspaces")
    .select("settings")
    .eq("id", ctx.workspaceId)
    .single();
  if (readError || !current) {
    console.error("[saveCompanyHours] leer", readError?.message);
    return { error: GENERIC_ERROR };
  }

  const settings = mergeBusinessHoursSettings(current.settings, checked.value) as Json;
  const { error } = await ctx.supabase
    .from("workspaces")
    .update({ settings })
    .eq("id", ctx.workspaceId)
    .select("id")
    .single();
  if (error) {
    console.error("[saveCompanyHours]", error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH);
  revalidatePath("/dashboard/settings/attention");
  return { ok: true };
}

/** Horario de un equipo; null = usar el horario de la empresa. */
export async function saveTeamHours(teamId: string, hours: unknown): Promise<HoursActionResult> {
  const ctx = await adminContext();
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!(await ownedTeam(ctx, teamId))) return { error: TEAM_NOT_FOUND };

  const checked = checkHoursInput(hours, "team");
  if (!checked.ok) return { error: checked.error };

  const { error } = await ctx.supabase
    .from("teams")
    .update({ business_hours: (checked.value as Json | null) ?? null, updated_at: new Date().toISOString() })
    .eq("id", teamId)
    .eq("workspace_id", ctx.workspaceId)
    .select("id")
    .single();
  if (error) {
    console.error("[saveTeamHours]", error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Agrega un feriado de la empresa (teamId null) o de un equipo. */
export async function addHoliday(input: {
  teamId: string | null;
  date: string;
  name: string;
}): Promise<HoursActionResult> {
  const ctx = await adminContext();
  if (ctx.error !== undefined) return { error: ctx.error };
  const teamId = input?.teamId ?? null;
  if (teamId !== null && !(await ownedTeam(ctx, teamId))) return { error: TEAM_NOT_FOUND };

  const checked = checkHolidayInput(input?.date, input?.name);
  if (!checked.ok) return { error: checked.error };

  const { error } = await ctx.supabase
    .from("holidays")
    .insert({ workspace_id: ctx.workspaceId, team_id: teamId, date: checked.date, name: checked.name });
  if (error) {
    if (error.code === "23505") return { error: "Ya hay un feriado en esa fecha." };
    console.error("[addHoliday]", error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Quita un feriado. */
export async function removeHoliday(id: string): Promise<HoursActionResult> {
  const ctx = await adminContext();
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!isId(id)) return { error: "No se encontró el feriado." };

  const { error } = await ctx.supabase.from("holidays").delete().eq("id", id).eq("workspace_id", ctx.workspaceId);
  if (error) {
    console.error("[removeHoliday]", error.message);
    return { error: GENERIC_ERROR };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Carga los feriados de Perú de un año sin duplicar los que ya existen (por fecha). */
export async function loadPeruHolidays(input: {
  teamId: string | null;
  year: number;
}): Promise<HoursActionResult<{ added: number; skipped: number }>> {
  const ctx = await adminContext();
  if (ctx.error !== undefined) return { error: ctx.error };
  const teamId = input?.teamId ?? null;
  if (teamId !== null && !(await ownedTeam(ctx, teamId))) return { error: TEAM_NOT_FOUND };
  if (!isHolidayYear(input?.year)) return { error: "El año no es válido." };
  const year = input.year;

  let existing = ctx.supabase
    .from("holidays")
    .select("date")
    .eq("workspace_id", ctx.workspaceId)
    .gte("date", `${year}-01-01`)
    .lte("date", `${year}-12-31`);
  existing = teamId === null ? existing.is("team_id", null) : existing.eq("team_id", teamId);
  const { data, error: readError } = await existing;
  if (readError) {
    console.error("[loadPeruHolidays] leer", readError.message);
    return { error: GENERIC_ERROR };
  }

  const missing = missingPeruHolidays(
    year,
    (data ?? []).map((r) => r.date),
  );
  const all = missingPeruHolidays(year, []).length;
  if (missing.length > 0) {
    const { error } = await ctx.supabase
      .from("holidays")
      .insert(missing.map((h) => ({ workspace_id: ctx.workspaceId, team_id: teamId, date: h.date, name: h.name })));
    if (error) {
      console.error("[loadPeruHolidays]", error.message);
      return { error: GENERIC_ERROR };
    }
  }
  revalidatePath(PATH);
  return { ok: true, added: missing.length, skipped: all - missing.length };
}
