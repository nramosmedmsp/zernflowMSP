// Carga del catálogo del laboratorio desde la base, solo lectura. Solo servidor.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assignmentModeFromSettings } from "@/lib/cases/routing";
import { parseBusinessHours, parseOffHoursReply, parseReassignAfterMinutes } from "@/lib/business-hours";
import type { GlobalKeyword } from "@/lib/flow-engine/global-keywords";
import type { Database } from "@/lib/types/database";
import { deriveTriggers, normalizeCatalog } from "./catalog";
import type { LabCaseType, LabCatalog, LabFlow, LabNode, LabEdge } from "./types";

type Db = SupabaseClient<Database>;

export interface LoadLabCatalogOptions {
  /** Cliente de lectura; por defecto el del usuario que hace la solicitud (respeta sus permisos). */
  db?: Db;
  /** Nombres de las personas por id de usuario (la base no los guarda): sin ellos, "Asesor 1", "Asesor 2"... */
  memberNames?: Record<string, string>;
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`No se pudo leer ${what}: ${result.error.message}`);
  return result.data ?? ([] as unknown as T);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Arma el catálogo del espacio para el laboratorio: flujos (publicados y
 * borradores) con sus disparadores derivados, tipos de gestión con etapas,
 * categorías, motivos y reglas, tipos de contacto, equipos y miembros,
 * horarios, feriados y palabras clave globales. Solo lee.
 */
export async function loadLabCatalog(workspaceId: string, options: LoadLabCatalogOptions = {}): Promise<LabCatalog> {
  let db = options.db;
  if (!db) {
    const { createClient } = await import("@/lib/supabase/server");
    db = (await createClient()) as Db;
  }

  const [workspace, flowRows, typeRows, contactTypeRows, teamRows, memberRows, holidayRows, fieldRows, tagRows] = await Promise.all([
    db.from("workspaces").select("name, settings, global_keywords").eq("id", workspaceId).single(),
    db.from("flows").select("id, name, status, nodes, edges").eq("workspace_id", workspaceId).neq("status", "archived").order("created_at", { ascending: true }),
    db.from("case_types").select("*").eq("workspace_id", workspaceId).is("archived_at", null).order("position", { ascending: true }),
    db.from("contact_types").select("id, name, is_default, position").eq("workspace_id", workspaceId).is("archived_at", null).order("position", { ascending: true }),
    db.from("teams").select("id, name, is_default, assignment_mode, business_hours").eq("workspace_id", workspaceId).is("archived_at", null),
    db.from("workspace_members").select("user_id, role, availability, last_assigned_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    db.from("holidays").select("date, team_id").eq("workspace_id", workspaceId),
    db.from("custom_field_definitions").select("slug, name").eq("workspace_id", workspaceId),
    db.from("tags").select("name").eq("workspace_id", workspaceId),
  ]);

  const ws = must(workspace, "el espacio de trabajo");
  const settings = (ws.settings && typeof ws.settings === "object" && !Array.isArray(ws.settings) ? ws.settings : {}) as Record<string, unknown>;
  const types = must(typeRows, "los tipos de gestión");
  const typeIds = types.map((t) => t.id);
  const teams = must(teamRows, "los equipos");

  const [stageRows, categoryRows, reasonRows, ruleRows, teamMemberRows] = await Promise.all([
    typeIds.length ? db.from("case_stages").select("id, case_type_id, name, kind, position").in("case_type_id", typeIds).is("archived_at", null).order("position", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    typeIds.length ? db.from("case_categories").select("id, case_type_id, name, is_high_priority, position").in("case_type_id", typeIds).is("archived_at", null).order("position", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    typeIds.length ? db.from("case_outcome_reasons").select("id, case_type_id, name, kind, position").in("case_type_id", typeIds).is("archived_at", null).order("position", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    typeIds.length ? db.from("case_rules").select("id, case_type_id, position, enabled, trigger, trigger_stage_id, condition, action, params").in("case_type_id", typeIds).eq("enabled", true).order("position", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    teams.length ? db.from("team_members").select("team_id, user_id, role, case_type_ids").in("team_id", teams.map((t) => t.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  const stages = must(stageRows, "las etapas");
  const categories = must(categoryRows, "las categorías");
  const reasons = must(reasonRows, "los motivos");
  const rules = must(ruleRows, "las reglas");

  const caseTypes: LabCaseType[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    position: t.position,
    isProactive: t.is_proactive,
    suggestedForContactTypeIds: t.suggested_for_contact_type_ids ?? [],
    routing: t.routing,
    fixedTeamId: t.fixed_team_id,
    requireCategory: t.require_category,
    requireOutcomeReason: t.require_outcome_reason,
    autoTemplate: t.auto_template,
    stages: stages.filter((s) => s.case_type_id === t.id).map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position })),
    categories: categories.filter((c) => c.case_type_id === t.id).map((c) => ({ id: c.id, name: c.name, isHighPriority: c.is_high_priority, position: c.position })),
    reasons: reasons.filter((r) => r.case_type_id === t.id).map((r) => ({ id: r.id, name: r.name, kind: r.kind, position: r.position })),
    rules: rules
      .filter((r) => r.case_type_id === t.id)
      .map((r) => ({
        id: r.id,
        position: r.position,
        enabled: r.enabled,
        trigger: r.trigger,
        trigger_stage_id: r.trigger_stage_id,
        condition: r.condition,
        action: r.action,
        params: r.params,
      })),
  }));

  const flows: LabFlow[] = must(flowRows, "los flujos").map((f) => ({
    id: f.id,
    name: f.name,
    status: f.status,
    nodes: asArray<LabNode>(f.nodes),
    edges: asArray<LabEdge>(f.edges),
  }));

  const names = options.memberNames ?? {};
  const members = must(memberRows, "los miembros").map((m, i) => ({
    userId: m.user_id,
    name: names[m.user_id] ?? `Asesor ${i + 1}`,
    role: m.role,
    availability: m.availability,
    lastAssignedAt: m.last_assigned_at,
  }));

  return normalizeCatalog({
    workspaceName: ws.name,
    flows,
    triggers: deriveTriggers(flows),
    caseTypes,
    contactTypes: must(contactTypeRows, "los tipos de contacto").map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default, position: t.position })),
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      isDefault: t.is_default,
      assignmentMode: t.assignment_mode,
      businessHours: parseBusinessHours(t.business_hours),
    })),
    members,
    teamMembers: must(teamMemberRows, "los miembros de equipos").map((m) => ({
      teamId: m.team_id,
      userId: m.user_id,
      role: m.role,
      caseTypeIds: m.case_type_ids,
    })),
    workspaceMode: assignmentModeFromSettings(settings),
    workspaceHours: parseBusinessHours(settings.business_hours),
    offHoursReply: parseOffHoursReply(settings.off_hours_reply),
    reassignAfterMinutes: parseReassignAfterMinutes(settings.reassign_after_minutes),
    // Sin la migración de feriados la tabla no existe: se sigue sin ellos.
    holidays: (holidayRows.error ? [] : (holidayRows.data ?? [])).map((h) => ({ date: String(h.date).slice(0, 10), teamId: h.team_id })),
    globalKeywords: asArray<GlobalKeyword>(ws.global_keywords).filter((k) => k && typeof k.keyword === "string"),
    customFields: (fieldRows.data ?? []).map((f) => ({ slug: f.slug, name: f.name })),
    tags: (tagRows.data ?? []).map((t) => t.name),
  });
}
