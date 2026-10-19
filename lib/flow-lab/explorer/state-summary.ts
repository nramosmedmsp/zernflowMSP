// Resumen en palabras del estado del contacto y la gestión, y lo que cambió
// entre dos estados. Puro.

import { CASE_ID_VARIABLE, FLOW_CHAIN_VARIABLE, CASE_EVENT_VARIABLE } from "@/lib/flow-engine/case-trigger-match";
import { caseTypeName, contactTypeName, indexCatalog, memberName, stageName, teamName } from "../catalog";
import { currentCase } from "../state";
import type { LabCatalog, LabState } from "../types";
import type { ExploreStateSummary } from "./types";

const STATUS_TEXT: Record<string, string> = {
  open: "Abierta",
  scheduled: "Programada",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
  cancelled: "Cancelada",
};

/** Variables que el motor pone al arrancar un flujo por un evento de gestión: no las cambia el flujo. */
const HIDDEN_VARIABLES = new Set([CASE_ID_VARIABLE, FLOW_CHAIN_VARIABLE, CASE_EVENT_VARIABLE, "case_type_id", "stage_id", "outcome"]);

/** Fecha «dd/mm/aaaa» en hora de Lima. */
export function limaDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/** Fecha y hora «dd/mm hh:mm» en hora de Lima. */
export function limaDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  const date = d.toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/");
  return `${date} ${d.toISOString().slice(11, 16)}`;
}

export function summarizeState(catalog: LabCatalog, state: LabState): ExploreStateSummary {
  const index = indexCatalog(catalog);
  const row = currentCase(state);
  const type = row?.caseTypeId ? index.caseTypeById.get(row.caseTypeId) : undefined;
  const variables: Record<string, string> = {};
  for (const session of state.sessions) {
    for (const [key, value] of Object.entries(session.variables)) {
      if (key.startsWith("__") || HIDDEN_VARIABLES.has(key)) continue;
      variables[key] = value;
    }
  }
  return {
    contactType: state.contact.contactTypeId ? contactTypeName(catalog, state.contact.contactTypeId) : null,
    tags: [...state.contact.tags],
    customFields: { ...state.contact.customFields },
    subscribed: state.contact.subscribed,
    owner: state.contact.ownerId ? memberName(catalog, state.contact.ownerId) : null,
    case: row
      ? {
          id: row.id,
          type: row.caseTypeId ? caseTypeName(catalog, row.caseTypeId) : null,
          stage: row.stageId ? stageName(catalog, row.stageId) : null,
          category: row.categoryId ? (type?.categories.find((c) => c.id === row.categoryId)?.name ?? row.categoryId) : null,
          status: STATUS_TEXT[row.status] ?? row.status,
          assignee: row.assigneeId ? memberName(catalog, row.assigneeId) : null,
          team: row.teamId ? teamName(catalog, row.teamId) : null,
        }
      : null,
    scheduled: state.cases
      .filter((c) => c.status === "scheduled")
      .map((c) => `${caseTypeName(catalog, c.caseTypeId)}${c.scheduledFor ? ` · ${limaDate(c.scheduledFor)}` : ""}`),
    botPaused: state.automationPaused,
    variables,
    notes: row ? row.notes.map((n) => n.body) : [],
  };
}

function list(items: readonly string[]): string {
  return items.map((i) => `«${i}»`).join(", ");
}

/** Lo que cambió entre el estado de partida y el final, en frases. */
export function diffSummaries(before: ExploreStateSummary, after: ExploreStateSummary): string[] {
  const out: string[] = [];
  if (before.contactType !== after.contactType) {
    out.push(`Tipo de contacto: ${before.contactType ?? "sin tipo"} → ${after.contactType ?? "sin tipo"}`);
  }
  const added = after.tags.filter((t) => !before.tags.includes(t));
  const removed = before.tags.filter((t) => !after.tags.includes(t));
  if (added.length > 0) out.push(`Etiquetas agregadas: ${list(added)}`);
  if (removed.length > 0) out.push(`Etiquetas quitadas: ${list(removed)}`);
  for (const [slug, value] of Object.entries(after.customFields)) {
    if (before.customFields[slug] !== value) out.push(`Campo «${slug}»: «${value}»`);
  }
  if (before.subscribed !== after.subscribed) out.push(after.subscribed ? "El contacto queda suscrito" : "El contacto queda dado de baja");
  if (before.owner !== after.owner) out.push(`Responsable del contacto: ${before.owner ?? "nadie"} → ${after.owner ?? "nadie"}`);

  const a = before.case;
  const b = after.case;
  if ((!a && b) || (a && b && a.id !== b.id)) {
    out.push(`Se abre una gestión nueva: ${b.type ?? "Sin clasificar"}${b.stage ? ` · ${b.stage}` : ""}${b.assignee ? ` · ${b.assignee}` : ""}`);
  } else if (a && b) {
    if (a.type !== b.type) out.push(`Tipo de gestión: ${a.type ?? "Sin clasificar"} → ${b.type ?? "Sin clasificar"}`);
    if (a.stage !== b.stage) out.push(`Etapa: ${a.stage ?? "sin etapa"} → ${b.stage ?? "sin etapa"}`);
    if (a.category !== b.category) out.push(`Categoría: ${a.category ?? "sin categoría"} → ${b.category ?? "sin categoría"}`);
    if (a.status !== b.status) out.push(`Estado de la gestión: ${a.status} → ${b.status}`);
    if (a.assignee !== b.assignee) out.push(`Responsable de la gestión: ${a.assignee ?? "nadie"} → ${b.assignee ?? "nadie"}`);
    if (a.team !== b.team) out.push(`Equipo: ${a.team ?? "sin equipo"} → ${b.team ?? "sin equipo"}`);
  }
  for (const s of after.scheduled) if (!before.scheduled.includes(s)) out.push(`Gestión programada: ${s}`);
  if (!before.botPaused && after.botPaused) out.push("El bot queda en pausa (atiende una persona)");
  for (const [name, value] of Object.entries(after.variables)) {
    if (name !== "message" && before.variables[name] !== value) out.push(`Variable «${name}»: «${value}»`);
  }
  for (const note of after.notes) if (!before.notes.includes(note)) out.push(`Nota interna: «${note}»`);
  return out;
}
