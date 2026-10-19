"use server";

// Escenarios guardados del laboratorio de flujos (lab_scenarios, migración 00023).
// Solo Dueño o Administrador. Se escribe con el cliente del usuario: RLS vuelve
// a exigir el rol. Los escenarios se corren en el navegador; aquí solo se guarda
// la definición y el último resultado.

import { createClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ADMIN_ONLY_MESSAGE, isAdminRole } from "@/lib/permissions";
import type { Json, WorkspaceSettings } from "@/lib/types/database";
import { exampleScenariosFor } from "@/lib/flow-lab/scenarios/examples";
import { normalizeName } from "@/lib/flow-lab/scenarios/names";
import type { ScenarioDefinition, ScenarioResult } from "@/lib/flow-lab/scenarios/types";
import { cleanName, parseScenarioDefinition, parseScenarioResult } from "@/lib/flow-lab/scenarios/validate";

export interface LabScenarioRow {
  id: string;
  name: string;
  description: string;
  /** null = la definición guardada ya no se entiende (ver definitionError). */
  definition: ScenarioDefinition | null;
  definitionError: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastResult: ScenarioResult | null;
}

export type LabScenarioResult<T extends object = object> = ({ ok: true } & T) | { error: string };

const GENERIC = "No se pudo completar la operación. Inténtalo de nuevo.";
const NOT_FOUND = "No se encontró el escenario.";
const DUPLICATE_NAME = "Ya hay un escenario con ese nombre.";
const NAME_ERROR = "Escribe un nombre de hasta 120 caracteres.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, name, description, definition, created_at, updated_at, last_run_at, last_result";

type DbRow = {
  id: string;
  name: string;
  description: string;
  definition: Json;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_result: Json | null;
};

function toRow(row: DbRow): LabScenarioRow {
  const parsed = parseScenarioDefinition(row.definition);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition: parsed.ok ? parsed.value : null,
    definitionError: parsed.ok ? null : parsed.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result ? parseScenarioResult(row.last_result) : null,
  };
}

interface Session {
  userId: string;
  workspaceId: string;
  settings: WorkspaceSettings;
  db: Awaited<ReturnType<typeof createClient>>;
}

/** Valida el rol y ejecuta. `getWorkspace()` puede redirigir (lanza), por eso va fuera del try. */
async function run<T extends object>(fn: (s: Session) => Promise<LabScenarioResult<T>>): Promise<LabScenarioResult<T>> {
  const { user, workspace, role } = await getWorkspace();
  if (!isAdminRole(role)) return { error: ADMIN_ONLY_MESSAGE };
  try {
    const db = await createClient();
    return await fn({ userId: user.id, workspaceId: workspace.id, settings: ((workspace as { settings?: unknown }).settings ?? {}) as WorkspaceSettings, db });
  } catch (err) {
    console.error("[lab-scenarios]", err);
    return { error: GENERIC };
  }
}

function dbError(error: { code?: string; message: string }): { error: string } {
  if (error.code === "23505") return { error: DUPLICATE_NAME };
  console.error("[lab-scenarios]", error.message);
  return { error: GENERIC };
}

export async function listLabScenarios(): Promise<LabScenarioResult<{ scenarios: LabScenarioRow[] }>> {
  return run(async (s) => {
    const { data, error } = await s.db.from("lab_scenarios").select(COLUMNS).eq("workspace_id", s.workspaceId).order("created_at", { ascending: true });
    if (error) return dbError(error);
    return { ok: true, scenarios: (data ?? []).map((r) => toRow(r as DbRow)) };
  });
}

export async function createLabScenario(input: { name: string; description?: string; definition: unknown }): Promise<LabScenarioResult<{ scenario: LabScenarioRow }>> {
  return run(async (s) => {
    const name = cleanName(input?.name);
    if (!name) return { error: NAME_ERROR };
    const parsed = parseScenarioDefinition(input.definition);
    if (!parsed.ok) return { error: parsed.error };
    const description = typeof input.description === "string" ? input.description.trim().slice(0, 2000) : "";
    const { data, error } = await s.db
      .from("lab_scenarios")
      .insert({ workspace_id: s.workspaceId, name, description, definition: parsed.value as unknown as Json, created_by: s.userId })
      .select(COLUMNS)
      .single();
    if (error) return dbError(error);
    return { ok: true, scenario: toRow(data as DbRow) };
  });
}

/** Cambia nombre, descripción y/o definición. Si cambia la definición, el último resultado deja de valer y se borra. */
export async function updateLabScenario(
  id: string,
  patch: { name?: string; description?: string; definition?: unknown },
): Promise<LabScenarioResult<{ scenario: LabScenarioRow }>> {
  return run(async (s) => {
    if (!UUID_RE.test(id)) return { error: NOT_FOUND };
    const update: { name?: string; description?: string; definition?: Json; last_result?: null; last_run_at?: null } = {};
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (!name) return { error: NAME_ERROR };
      update.name = name;
    }
    if (patch.description !== undefined) update.description = String(patch.description).trim().slice(0, 2000);
    if (patch.definition !== undefined) {
      const parsed = parseScenarioDefinition(patch.definition);
      if (!parsed.ok) return { error: parsed.error };
      update.definition = parsed.value as unknown as Json;
      update.last_result = null;
      update.last_run_at = null;
    }
    if (Object.keys(update).length === 0) return { error: "No hay nada que guardar." };
    const { data, error } = await s.db.from("lab_scenarios").update(update).eq("id", id).eq("workspace_id", s.workspaceId).select(COLUMNS).maybeSingle();
    if (error) return dbError(error);
    if (!data) return { error: NOT_FOUND };
    return { ok: true, scenario: toRow(data as DbRow) };
  });
}

export async function deleteLabScenario(id: string): Promise<LabScenarioResult> {
  return run(async (s) => {
    if (!UUID_RE.test(id)) return { error: NOT_FOUND };
    const { error } = await s.db.from("lab_scenarios").delete().eq("id", id).eq("workspace_id", s.workspaceId);
    if (error) return dbError(error);
    return { ok: true };
  });
}

/** Guarda el resultado de una o varias corridas (hechas en el navegador). */
export async function saveLabScenarioResults(items: { id: string; result: ScenarioResult }[]): Promise<LabScenarioResult<{ saved: number }>> {
  return run(async (s) => {
    if (!Array.isArray(items) || items.length === 0) return { ok: true, saved: 0 };
    let saved = 0;
    for (const item of items.slice(0, 200)) {
      const result = parseScenarioResult(item?.result);
      if (!result || !UUID_RE.test(item.id)) continue;
      const { data, error } = await s.db
        .from("lab_scenarios")
        .update({ last_result: result as unknown as Json, last_run_at: result.ranAt })
        .eq("id", item.id)
        .eq("workspace_id", s.workspaceId)
        .select("id");
      if (error) return dbError(error);
      saved += data?.length ?? 0;
    }
    return { ok: true, saved };
  });
}

export async function saveLabScenarioResult(id: string, result: ScenarioResult): Promise<LabScenarioResult<{ saved: number }>> {
  return saveLabScenarioResults([{ id, result }]);
}

/** Instala los escenarios de ejemplo de la plantilla del negocio (settings.business_template), sin duplicar por nombre. */
export async function addExampleLabScenarios(): Promise<LabScenarioResult<{ added: number; skipped: number; scenarios: LabScenarioRow[] }>> {
  return run(async (s) => {
    const examples = exampleScenariosFor(s.settings.business_template);
    if (examples.length === 0) {
      return { error: "No hay escenarios de ejemplo para la plantilla de negocio de este espacio (solo E-commerce y Gimnasio)." };
    }
    const { data: existing, error: readError } = await s.db.from("lab_scenarios").select("name").eq("workspace_id", s.workspaceId);
    if (readError) return dbError(readError);
    const taken = new Set((existing ?? []).map((r) => normalizeName(r.name)));
    const fresh = examples.filter((e) => !taken.has(normalizeName(e.name)));
    if (fresh.length === 0) return { ok: true, added: 0, skipped: examples.length, scenarios: [] };
    const { data, error } = await s.db
      .from("lab_scenarios")
      .insert(fresh.map((e) => ({ workspace_id: s.workspaceId, name: e.name, description: e.description, definition: e.definition as unknown as Json, created_by: s.userId })))
      .select(COLUMNS);
    if (error) return dbError(error);
    return { ok: true, added: fresh.length, skipped: examples.length - fresh.length, scenarios: (data ?? []).map((r) => toRow(r as DbRow)) };
  });
}
