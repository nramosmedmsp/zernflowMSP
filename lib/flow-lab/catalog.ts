// Catálogo del laboratorio: disparadores derivados, índices y textos de apoyo.
// Puro: sin acceso a la base (loadLabCatalog está en load-catalog.ts).

import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { buildHoursInfo, type HoursInfo } from "@/lib/cases/hours";
import { triggerMinutes } from "@/lib/flow-engine/case-trigger-match";
import type { Json } from "@/lib/types/database";
import type {
  LabCaseType,
  LabCatalog,
  LabContactType,
  LabFlow,
  LabMember,
  LabStage,
  LabState,
  LabTeam,
  LabTrigger,
} from "./types";

/**
 * Disparadores de los flujos, derivados con buildDesiredTriggers (la misma
 * función que usa la publicación). Se derivan de todos los flujos, también de
 * los borradores: la simulación decide cuáles están activos. El orden es el del
 * catálogo, así que dentro de la misma prioridad gana el primero.
 */
export function deriveTriggers(flows: readonly LabFlow[]): LabTrigger[] {
  const out: LabTrigger[] = [];
  for (const flow of flows) {
    let index = 0;
    for (const node of flow.nodes) {
      if (node.type !== "trigger") continue;
      const rows = buildDesiredTriggers([node as unknown as Record<string, unknown>], flow.id);
      for (const row of rows) {
        out.push({
          id: `${flow.id}:trigger:${++index}`,
          flowId: flow.id,
          type: row.type,
          config: row.config,
          priority: row.priority,
          isActive: row.is_active,
          nodeId: node.id,
        });
      }
    }
  }
  return out;
}

/** Completa el catálogo (disparadores derivados y valores por defecto). Úsalo si armas uno a mano. */
export function normalizeCatalog(partial: Partial<LabCatalog> & Pick<LabCatalog, "flows">): LabCatalog {
  return {
    version: 1,
    workspaceName: partial.workspaceName ?? "Mi empresa",
    flows: partial.flows,
    triggers: partial.triggers ?? deriveTriggers(partial.flows),
    caseTypes: partial.caseTypes ?? [],
    contactTypes: partial.contactTypes ?? [],
    teams: partial.teams ?? [],
    members: partial.members ?? [],
    teamMembers: partial.teamMembers ?? [],
    workspaceMode: partial.workspaceMode ?? "round_robin",
    workspaceHours: partial.workspaceHours ?? null,
    offHoursReply: partial.offHoursReply ?? null,
    reassignAfterMinutes: partial.reassignAfterMinutes ?? null,
    holidays: partial.holidays ?? [],
    globalKeywords: partial.globalKeywords ?? [],
    customFields: partial.customFields ?? [],
    tags: partial.tags ?? [],
  };
}

export interface LabIndex {
  catalog: LabCatalog;
  flowById: Map<string, LabFlow>;
  caseTypeById: Map<string, LabCaseType>;
  stageById: Map<string, { stage: LabStage; caseType: LabCaseType }>;
  contactTypeById: Map<string, LabContactType>;
  teamById: Map<string, LabTeam>;
  memberById: Map<string, LabMember>;
  /** Horarios, feriados y respuesta fuera de horario con el mismo armado que el motor real. */
  hours: HoursInfo;
}

const indexCache = new WeakMap<LabCatalog, LabIndex>();

export function indexCatalog(catalog: LabCatalog): LabIndex {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const stageById = new Map<string, { stage: LabStage; caseType: LabCaseType }>();
  for (const caseType of catalog.caseTypes) {
    for (const stage of caseType.stages) stageById.set(stage.id, { stage, caseType });
  }
  const settings: Record<string, unknown> = {
    business_hours: catalog.workspaceHours,
    off_hours_reply: catalog.offHoursReply,
    reassign_after_minutes: catalog.reassignAfterMinutes,
    assignment_mode: catalog.workspaceMode,
  };
  const index: LabIndex = {
    catalog,
    flowById: new Map(catalog.flows.map((f) => [f.id, f])),
    caseTypeById: new Map(catalog.caseTypes.map((t) => [t.id, t])),
    stageById,
    contactTypeById: new Map(catalog.contactTypes.map((t) => [t.id, t])),
    teamById: new Map(catalog.teams.map((t) => [t.id, t])),
    memberById: new Map(catalog.members.map((m) => [m.userId, m])),
    hours: buildHoursInfo({
      workspace: { name: catalog.workspaceName, settings: settings as unknown as Json },
      teams: catalog.teams.map((t) => ({ id: t.id, name: t.name, business_hours: t.businessHours as unknown as Json })),
      holidays: catalog.holidays.map((h) => ({ date: h.date, team_id: h.teamId })),
    }),
  };
  indexCache.set(catalog, index);
  return index;
}

/** Flujos activos en la simulación: los elegidos, o todos los publicados. */
export function activeFlowIds(catalog: LabCatalog, state: Pick<LabState, "enabledFlowIds">): Set<string> {
  if (state.enabledFlowIds) {
    const known = new Set(catalog.flows.map((f) => f.id));
    return new Set(state.enabledFlowIds.filter((id) => known.has(id)));
  }
  return new Set(catalog.flows.filter((f) => f.status === "published").map((f) => f.id));
}

/** Disparadores activos de los flujos activos, de mayor a menor prioridad (estable). */
export function activeTriggers(catalog: LabCatalog, state: Pick<LabState, "enabledFlowIds">, type?: string): LabTrigger[] {
  const flows = activeFlowIds(catalog, state);
  return catalog.triggers
    .filter((t) => t.isActive && flows.has(t.flowId) && (!type || t.type === type))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.priority - a.t.priority || a.i - b.i)
    .map((x) => x.t);
}

const OUTCOME_TEXT: Record<string, string> = { won: "ganada", lost: "perdida", resolved: "resuelta" };

/** Cómo se lee un disparador, en español. */
export function describeTrigger(catalog: LabCatalog, trigger: LabTrigger): string {
  const config = (trigger.config && typeof trigger.config === "object" ? trigger.config : {}) as Record<string, unknown>;
  const index = indexCatalog(catalog);
  const typeName = typeof config.case_type_id === "string" ? index.caseTypeById.get(config.case_type_id)?.name : undefined;
  const ofType = typeName ? ` de ${typeName}` : "";
  switch (trigger.type) {
    case "keyword": {
      const keywords = Array.isArray(config.keywords) ? config.keywords : [];
      if (keywords.length === 0) return "palabras clave (sin ninguna configurada)";
      const parts = keywords.map((k: unknown) => {
        const value = typeof k === "string" ? k : ((k as { value?: string })?.value ?? "");
        const matchType =
          (typeof k === "object" && k ? (k as { matchType?: string }).matchType : undefined) ??
          (config.matchType as string | undefined) ??
          "contains";
        const how = matchType === "exact" ? "exacta" : matchType === "startsWith" ? "al inicio" : "contiene";
        return `«${value}» (${how})`;
      });
      return `palabras clave: ${parts.join(", ")}`;
    }
    case "postback":
      return `botón con carga «${String(config.payload ?? "")}»`;
    case "quick_reply":
      return `respuesta rápida con carga «${String(config.payload ?? "")}»`;
    case "welcome":
      return "primer mensaje del contacto";
    case "default":
      return "cualquier otro mensaje (por defecto)";
    case "case_opened": {
      const wanted = Array.isArray(config.contact_type_ids) ? config.contact_type_ids.filter((v): v is string => typeof v === "string") : [];
      const names = wanted.map((id) => index.contactTypeById.get(id)?.name ?? id);
      return `gestión nueva${config.only_unclassified === true ? " sin clasificar" : ""}${names.length > 0 ? ` (clientes de tipo ${names.join(", ")})` : ""}`;
    }
    case "case_stage_changed": {
      const stageId = typeof config.stage_id === "string" ? config.stage_id : null;
      const stage = stageId ? index.stageById.get(stageId)?.stage.name : undefined;
      return stage ? `la gestión${ofType} pasa a la etapa «${stage}»` : `cambio de etapa de una gestión${ofType}`;
    }
    case "case_closed": {
      const outcome = typeof config.outcome === "string" ? OUTCOME_TEXT[config.outcome] : undefined;
      return `gestión${ofType} cerrada${outcome ? ` como ${outcome}` : ""}`;
    }
    case "client_no_reply":
      return `cliente sin responder durante ${triggerMinutes(config)} min${typeName ? ` (gestiones de ${typeName})` : ""}`;
    default:
      return trigger.type;
  }
}

export function memberName(catalog: LabCatalog, userId: string | null | undefined): string {
  if (!userId) return "nadie";
  return indexCatalog(catalog).memberById.get(userId)?.name ?? userId;
}

export function stageName(catalog: LabCatalog, stageId: string | null | undefined): string {
  if (!stageId) return "sin etapa";
  return indexCatalog(catalog).stageById.get(stageId)?.stage.name ?? stageId;
}

export function caseTypeName(catalog: LabCatalog, caseTypeId: string | null | undefined): string {
  if (!caseTypeId) return "Sin clasificar";
  return indexCatalog(catalog).caseTypeById.get(caseTypeId)?.name ?? caseTypeId;
}

export function teamName(catalog: LabCatalog, teamId: string | null | undefined): string {
  if (!teamId) return "sin equipo";
  return indexCatalog(catalog).teamById.get(teamId)?.name ?? teamId;
}

export function contactTypeName(catalog: LabCatalog, id: string | null | undefined): string {
  if (!id) return "sin tipo";
  return indexCatalog(catalog).contactTypeById.get(id)?.name ?? id;
}
