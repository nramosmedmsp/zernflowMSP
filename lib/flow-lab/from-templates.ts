// Catálogo armado con las plantillas de negocio (lib/business-templates.ts) y de
// flujos (lib/flow-templates): lo mismo que quedaría en un espacio nuevo tras
// aplicar la plantilla de negocio e instalar los flujos. Sirve para las
// pruebas, para probar el laboratorio sin base y como ejemplo de cómo se arma
// un catálogo a mano. Usa applyTemplateWithStore con una base en memoria, así
// que ids, posiciones y reglas salen de la misma lógica que el alta real.

import {
  applyTemplateWithStore,
  normalizeName,
  type ExistingConfig,
  type NewCaseType,
  type NewCategory,
  type NewContactType,
  type NewReason,
  type NewRule,
  type NewStage,
  type TemplateStore,
} from "@/lib/business-templates";
import { FLOW_TEMPLATES, getFlowTemplate } from "@/lib/flow-templates";
import { resolveFlowTemplate } from "@/lib/flow-templates/resolve";
import type { FlowTemplate, TemplateCatalog } from "@/lib/flow-templates/types";
import type { BusinessTemplate, Json, MemberAvailability, WorkspaceRole } from "@/lib/types/database";
import { deriveTriggers, normalizeCatalog } from "./catalog";
import type {
  LabCaseType,
  LabCatalog,
  LabContactType,
  LabFlow,
  LabHoliday,
  LabMember,
  LabTeam,
  LabTeamMember,
} from "./types";

/** Base en memoria para applyTemplateWithStore (ids "ct-1", "cs-1"...). */
function memoryStore() {
  const counters: Record<string, number> = {};
  const id = (prefix: string) => `${prefix}-${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
  const contactTypes: (NewContactType & { id: string })[] = [];
  const caseTypes: (NewCaseType & { id: string })[] = [];
  const stages: (NewStage & { id: string })[] = [];
  const categories: (NewCategory & { id: string })[] = [];
  const reasons: (NewReason & { id: string })[] = [];
  const rules: (NewRule & { id: string })[] = [];
  let settings: Record<string, unknown> = {};

  const store: TemplateStore = {
    async load(): Promise<ExistingConfig> {
      return {
        contactTypes: contactTypes.map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default, archived: false, position: t.position })),
        caseTypes: caseTypes.map((t) => ({
          id: t.id,
          name: t.name,
          position: t.position,
          stages: stages.filter((s) => s.case_type_id === t.id),
          categories: categories.filter((c) => c.case_type_id === t.id),
          reasons: reasons.filter((r) => r.case_type_id === t.id),
          rules: rules.filter((r) => r.case_type_id === t.id).map((r) => ({ ...r, trigger_stage_id: null })),
        })),
        settings,
      };
    },
    async insertContactTypes(rows) {
      return rows.map((r) => {
        const row = { ...r, id: id("cot") };
        contactTypes.push(row);
        return { id: row.id, name: row.name };
      });
    },
    async insertCaseTypes(rows) {
      return rows.map((r) => {
        const row = { ...r, id: id("ct") };
        caseTypes.push(row);
        return { id: row.id, name: row.name };
      });
    },
    async insertStages(rows) {
      for (const r of rows) stages.push({ ...r, id: id("cs") });
    },
    async insertCategories(rows) {
      for (const r of rows) categories.push({ ...r, id: id("cc") });
    },
    async insertReasons(rows) {
      for (const r of rows) reasons.push({ ...r, id: id("cr") });
    },
    async insertRules(rows) {
      for (const r of rows) rules.push({ ...r, id: id("rule") });
    },
    async saveSettings(_workspaceId, next) {
      settings = next;
    },
  };
  return { store, contactTypes, caseTypes, stages, categories, reasons, rules, getSettings: () => settings };
}

export interface BuildCatalogOptions {
  /** Plantilla de negocio ("ecommerce", "gym", "general"). Por defecto "ecommerce". */
  business?: BusinessTemplate;
  /**
   * Plantillas de flujos que se instalan y publican: ids, o "all" para todas las
   * del negocio y las generales. Por defecto, las del negocio y las generales.
   */
  flowTemplates?: readonly string[] | "all";
  /** Estado de los flujos instalados (por defecto "published"). */
  flowStatus?: "published" | "draft";
  workspaceName?: string;
  /** Asesores (por defecto dos: Ana y Beto, miembros disponibles). */
  members?: Array<{ userId: string; name: string; role?: WorkspaceRole; availability?: MemberAvailability }>;
  teams?: LabTeam[];
  teamMembers?: LabTeamMember[];
  holidays?: LabHoliday[];
  workspaceHours?: LabCatalog["workspaceHours"];
  offHoursReply?: LabCatalog["offHoursReply"];
  globalKeywords?: LabCatalog["globalKeywords"];
  customFields?: LabCatalog["customFields"];
  tags?: string[];
  /** Cambia un tipo de gestión después de armarlo (por nombre), por ejemplo para ponerle plantilla automática. */
  patchCaseTypes?: Record<string, Partial<LabCaseType>>;
}

export const DEFAULT_LAB_MEMBERS = [
  { userId: "u-ana", name: "Ana", role: "member" as const, availability: "available" as const },
  { userId: "u-beto", name: "Beto", role: "member" as const, availability: "available" as const },
];

/** Catálogo de un espacio nuevo con la plantilla de negocio y los flujos instalados (publicados). */
export async function buildCatalogFromTemplates(options: BuildCatalogOptions = {}): Promise<LabCatalog> {
  const business = options.business ?? "ecommerce";
  const memory = memoryStore();
  await applyTemplateWithStore(memory.store, "lab", business);

  const stagesByType = new Map<string, Array<NewStage & { id: string }>>();
  for (const s of memory.stages) stagesByType.set(s.case_type_id, [...(stagesByType.get(s.case_type_id) ?? []), s]);

  const contactTypes: LabContactType[] = memory.contactTypes.map((t) => ({
    id: t.id,
    name: t.name,
    isDefault: t.is_default,
    position: t.position,
  }));
  let caseTypes: LabCaseType[] = memory.caseTypes.map((t) => ({
    id: t.id,
    name: t.name,
    position: t.position,
    isProactive: t.is_proactive,
    suggestedForContactTypeIds: t.suggested_for_contact_type_ids,
    routing: "contact_owner",
    fixedTeamId: null,
    requireCategory: t.require_category,
    requireOutcomeReason: t.require_outcome_reason,
    autoTemplate: null,
    stages: (stagesByType.get(t.id) ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position })),
    categories: memory.categories
      .filter((c) => c.case_type_id === t.id)
      .map((c) => ({ id: c.id, name: c.name, isHighPriority: c.is_high_priority, position: c.position })),
    reasons: memory.reasons
      .filter((r) => r.case_type_id === t.id)
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind, position: r.position })),
    rules: memory.rules
      .filter((r) => r.case_type_id === t.id)
      .map((r) => ({
        id: r.id,
        position: r.position,
        enabled: true,
        trigger: r.trigger,
        trigger_stage_id: null,
        condition: r.condition as Json,
        action: r.action,
        params: r.params as Json,
      })),
  }));
  for (const [name, patch] of Object.entries(options.patchCaseTypes ?? {})) {
    caseTypes = caseTypes.map((t) => (normalizeName(t.name) === normalizeName(name) ? { ...t, ...patch } : t));
  }

  const members: LabMember[] = (options.members ?? DEFAULT_LAB_MEMBERS).map((m) => ({
    userId: m.userId,
    name: m.name,
    role: m.role ?? "member",
    availability: m.availability ?? "available",
    lastAssignedAt: null,
  }));

  const templateCatalog: TemplateCatalog = {
    caseTypes: caseTypes.map((t) => ({
      id: t.id,
      name: t.name,
      stages: t.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
      categories: t.categories.map((c) => ({ id: c.id, name: c.name })),
    })),
    teams: (options.teams ?? []).map((t) => ({ id: t.id, name: t.name })),
    contactTypes: contactTypes.map((t) => ({ id: t.id, name: t.name })),
  };

  const wanted: FlowTemplate[] =
    options.flowTemplates === "all"
      ? [...FLOW_TEMPLATES]
      : options.flowTemplates
        ? options.flowTemplates.map((id) => {
            const t = getFlowTemplate(id);
            if (!t) throw new Error(`No existe la plantilla de flujo «${id}».`);
            return t;
          })
        : FLOW_TEMPLATES.filter((t) => t.business === business || t.business === "general");

  const customFields = new Map<string, string>((options.customFields ?? []).map((f) => [f.slug, f.name]));
  const flows: LabFlow[] = wanted.map((template) => {
    const resolved = resolveFlowTemplate(template, templateCatalog);
    for (const f of template.customFields ?? []) if (!customFields.has(f.slug)) customFields.set(f.slug, f.name);
    return {
      id: `flow-${template.id}`,
      name: template.name,
      status: options.flowStatus ?? "published",
      nodes: resolved.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: resolved.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
    };
  });

  return normalizeCatalog({
    workspaceName: options.workspaceName ?? "Tienda de prueba",
    flows,
    triggers: deriveTriggers(flows),
    caseTypes,
    contactTypes,
    teams: options.teams ?? [],
    members,
    teamMembers: options.teamMembers ?? [],
    holidays: options.holidays ?? [],
    workspaceHours: options.workspaceHours ?? null,
    offHoursReply: options.offHoursReply ?? null,
    globalKeywords: options.globalKeywords ?? [],
    customFields: [...customFields].map(([slug, name]) => ({ slug, name })),
    tags: options.tags ?? [],
  });
}
