// Variantes del estado de partida. Una condición del flujo sobre el contacto o la
// gestión (etiqueta, tipo de contacto, etapa, horario...) se explora probando el
// flujo desde un estado en que cada salida pueda cumplirse. Cada «dimensión» es
// una de esas cosas con sus opciones; el explorador las prueba cuando un camino
// evalúa una condición que depende de ella.

import { isOpenAt } from "@/lib/cases/hours";
import { isCaseConditionField } from "@/lib/flow-engine/case-conditions";
import { parseConditionField, upgradeCondition, type FlowCondition } from "@/lib/flow-engine/condition-fields";
import { nodeKind } from "@/lib/flow-engine/node-kind";
import { caseTypeName, contactTypeName, indexCatalog, stageName, teamName } from "../catalog";
import { LAB_CHANNEL_LABELS, LAB_CHANNELS, type LabCatalog, type LabFlow, type LabState } from "../types";
import { closeWindow, ensureOpenCase, firstOpenStageId } from "./seed";

export interface VariantOption {
  id: string;
  /** «Con la etiqueta VIP». */
  label: string;
  apply: (catalog: LabCatalog, state: LabState) => void;
}

export interface Dimension {
  key: string;
  options: VariantOption[];
}

export interface Clocks {
  /** Un instante dentro del horario de atención (null si no se encontró). */
  inside: string | null;
  /** Un instante fuera del horario (null si el espacio atiende las 24 horas). */
  outside: string | null;
}

const OTHER_VALUE = "otro valor";

/** Un valor que hace que la comparación se cumpla (null = no aplica). */
export function satisfyingValue(operator: string, value: string): string | null {
  const n = Number(value);
  switch (operator) {
    case "equals":
    case "contains":
      return value;
    case "not_equals":
      return OTHER_VALUE;
    case "exists":
      return "valor de prueba";
    case "gt":
      return Number.isFinite(n) ? String(n + 1) : null;
    case "lt":
      return Number.isFinite(n) ? String(n - 1) : null;
    default:
      return null;
  }
}

/** Un valor que hace que la comparación no se cumpla (null = dejar el campo vacío). */
export function violatingValue(operator: string, value: string): string | null {
  const n = Number(value);
  switch (operator) {
    case "equals":
    case "contains":
      return OTHER_VALUE;
    case "not_equals":
      return value;
    case "gt":
      return Number.isFinite(n) ? String(n - 1) : OTHER_VALUE;
    case "lt":
      return Number.isFinite(n) ? String(n + 1) : OTHER_VALUE;
    default:
      return null;
  }
}

/** Clave de la dimensión de una condición (null = no depende del estado de partida: variables y respuestas). */
export function dimensionKeyOf(condition: FlowCondition): string | null {
  if (isCaseConditionField(condition.field)) return condition.field;
  const parsed = parseConditionField(upgradeCondition(condition, isCaseConditionField));
  switch (parsed.kind) {
    case "platform":
    case "is_subscribed":
      return parsed.kind;
    case "tag":
      return parsed.name ? `tag:${parsed.name}` : null;
    case "custom_field":
      return parsed.name ? `field:${parsed.name}` : null;
    case "variable":
      return null;
  }
}

/** ¿La condición mira la respuesta del cliente ({{message}})? */
export function isMessageCondition(condition: FlowCondition): boolean {
  if (isCaseConditionField(condition.field)) return false;
  const parsed = parseConditionField(upgradeCondition(condition, isCaseConditionField));
  return parsed.kind === "variable" && parsed.name === "message";
}

export function conditionsOf(node: { data?: unknown }): FlowCondition[] {
  const raw = (node.data as { conditions?: unknown } | undefined)?.conditions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ field: String(c.field ?? ""), operator: String(c.operator ?? "equals"), value: String(c.value ?? "") }));
}

export function abDimensionKey(flowId: string, nodeId: string): string {
  return `ab:${flowId}:${nodeId}`;
}

/** Caminos de una prueba A/B con su peso. */
export function abPathsOf(node: { data?: unknown }): Array<{ name: string; weight: number }> {
  const raw = (node.data as { paths?: unknown } | undefined)?.paths;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { name: string; weight?: unknown } => !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string")
    .map((p) => ({ name: p.name, weight: Number(p.weight) > 0 ? Number(p.weight) : 1 }));
}

/** Número entre 0 y 1 que hace que la prueba A/B elija el camino indicado (el centro de su tramo). */
export function abRandomFor(paths: ReadonlyArray<{ name: string; weight: number }>, name: string): number {
  const total = paths.reduce((sum, p) => sum + p.weight, 0);
  let before = 0;
  for (const p of paths) {
    if (p.name === name) return (before + p.weight / 2) / total;
    before += p.weight;
  }
  return 0;
}

/** Un instante dentro y otro fuera del horario de atención, a partir del reloj de partida. */
export function findClocks(catalog: LabCatalog, baseIso: string): Clocks {
  const info = indexCatalog(catalog).hours;
  const base = new Date(baseIso).getTime();
  const result: Clocks = { inside: null, outside: null };
  const teamSets: Array<Array<string | null>> = [[null, ...catalog.teams.map((t) => t.id)], [null]];
  for (const teams of teamSets) {
    for (let i = 0; i < 14 * 48 && (!result.inside || !result.outside); i++) {
      const at = new Date(base + i * 30 * 60_000);
      const open = teams.map((t) => isOpenAt(info, t, at));
      if (!result.inside && open.every(Boolean)) result.inside = at.toISOString();
      if (!result.outside && open.every((o) => !o)) result.outside = at.toISOString();
    }
  }
  return result;
}

interface Reference {
  conditions: FlowCondition[];
}

function referencedValues(refs: Reference): string[] {
  return [...new Set(refs.conditions.map((c) => c.value).filter((v) => v !== ""))];
}

/** Las dimensiones de los flujos (las condiciones de todos sus nodos), con las opciones que se pueden probar. */
export function buildDimensions(catalog: LabCatalog, flows: readonly LabFlow[], clocks: Clocks): Map<string, Dimension> {
  const index = indexCatalog(catalog);
  const refs = new Map<string, Reference>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (nodeKind(node) !== "condition") continue;
      for (const raw of conditionsOf(node)) {
        const condition = upgradeCondition(raw, isCaseConditionField);
        const key = dimensionKeyOf(condition);
        if (!key) continue;
        const ref = refs.get(key) ?? { conditions: [] };
        ref.conditions.push(condition);
        refs.set(key, ref);
      }
    }
  }

  const dims = new Map<string, Dimension>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (nodeKind(node) !== "abSplit") continue;
      const paths = abPathsOf(node);
      if (paths.length < 2) continue;
      const key = abDimensionKey(flow.id, node.id);
      dims.set(key, {
        key,
        options: paths.map((p) => option(`${key}=${p.name}`, `Prueba A/B: camino «${p.name}»`, () => {})),
      });
    }
  }
  for (const [key, ref] of refs) {
    const options = optionsFor(catalog, index, key, ref, clocks);
    if (options.length > 0) dims.set(key, { key, options });
  }
  return dims;
}

function option(id: string, label: string, apply: VariantOption["apply"]): VariantOption {
  return { id, label, apply };
}

function optionsFor(catalog: LabCatalog, index: ReturnType<typeof indexCatalog>, key: string, ref: Reference, clocks: Clocks): VariantOption[] {
  const values = referencedValues(ref);
  switch (key) {
    case "contact_type": {
      const ids = values.filter((v) => index.contactTypeById.has(v));
      const other = catalog.contactTypes.find((t) => !ids.includes(t.id))?.id ?? null;
      const list: Array<string | null> = [...ids, other];
      return list.map((id) =>
        option(`${key}=${id ?? "none"}`, id ? `Contacto de tipo «${contactTypeName(catalog, id)}»` : "Contacto sin tipo", (_c, s) => {
          s.contact.contactTypeId = id;
        }),
      );
    }
    case "case_type": {
      const ids = values.filter((v) => index.caseTypeById.has(v));
      const other = catalog.caseTypes.find((t) => !ids.includes(t.id))?.id ?? null;
      return [...ids, ...(other ? [other] : [])].map((id) =>
        option(`${key}=${id}`, `Gestión de tipo «${caseTypeName(catalog, id)}»`, (c, s) => {
          const row = ensureOpenCase(c, s, { caseTypeId: id });
          row.caseTypeId = id;
          row.stageId = firstOpenStageId(index.caseTypeById.get(id));
        }),
      );
    }
    case "case_stage": {
      const ids = values.filter((v) => index.stageById.get(v)?.stage.kind === "open");
      return ids.map((id) =>
        option(`${key}=${id}`, `Gestión en la etapa «${stageName(catalog, id)}»`, (c, s) => {
          const found = index.stageById.get(id);
          const row = ensureOpenCase(c, s, { caseTypeId: found?.caseType.id, stageId: id });
          row.caseTypeId = found?.caseType.id ?? row.caseTypeId;
          row.stageId = id;
        }),
      );
    }
    case "case_team": {
      const ids = values.filter((v) => index.teamById.has(v));
      return [
        ...ids.map((id) =>
          option(`${key}=${id}`, `Gestión del equipo «${teamName(catalog, id)}»`, (c, s) => {
            ensureOpenCase(c, s).teamId = id;
          }),
        ),
        option(`${key}=none`, "Gestión sin equipo", (c, s) => {
          ensureOpenCase(c, s).teamId = null;
        }),
      ];
    }
    case "has_assignee":
      return [
        option(`${key}=yes`, "Gestión con responsable", (c, s) => {
          const row = ensureOpenCase(c, s);
          const member = c.members[0]?.userId ?? null;
          if (member) row.assigneeId = member;
        }),
        option(`${key}=no`, "Gestión sin responsable", (c, s) => {
          const row = ensureOpenCase(c, s);
          row.assigneeId = null;
          row.assignedAt = null;
        }),
      ];
    case "within_hours": {
      const out: VariantOption[] = [];
      const { inside, outside } = clocks;
      if (inside) out.push(option(`${key}=in`, "Dentro del horario de atención", (_c, s) => { s.clock = inside; }));
      if (outside) out.push(option(`${key}=out`, "Fuera del horario de atención", (_c, s) => { s.clock = outside; }));
      return out;
    }
    case "platform":
      return LAB_CHANNELS.map((channel) =>
        option(`${key}=${channel}`, `Canal ${LAB_CHANNEL_LABELS[channel]}`, (_c, s) => {
          s.channel = channel;
        }),
      );
    case "is_subscribed":
      return [
        option(`${key}=yes`, "Contacto suscrito", (_c, s) => { s.contact.subscribed = true; }),
        option(`${key}=no`, "Contacto dado de baja", (_c, s) => { s.contact.subscribed = false; }),
      ];
    default:
      break;
  }
  if (key.startsWith("tag:")) {
    const tag = key.slice(4);
    return [
      option(`${key}=with`, `Con la etiqueta «${tag}»`, (_c, s) => {
        if (!s.contact.tags.includes(tag)) s.contact.tags.push(tag);
      }),
      option(`${key}=without`, `Sin la etiqueta «${tag}»`, (_c, s) => {
        s.contact.tags = s.contact.tags.filter((t) => t !== tag);
      }),
    ];
  }
  if (key.startsWith("field:")) {
    const slug = key.slice(6);
    const label = catalog.customFields.find((f) => f.slug === slug)?.name ?? slug;
    const wanted = new Set<string | null>();
    for (const c of ref.conditions) {
      wanted.add(satisfyingValue(c.operator, c.value));
      wanted.add(violatingValue(c.operator, c.value));
    }
    return [...wanted].map((value) =>
      value === null
        ? option(`${key}=unset`, `Campo «${label}» vacío`, (_c, s) => { delete s.contact.customFields[slug]; })
        : option(`${key}=${value}`, `Campo «${label}» = «${value}»`, (_c, s) => { s.contact.customFields[slug] = value; }),
    );
  }
  return [];
}

/** La variante estática de la ventana de 24 h (solo flujos que arrancan por un evento en WhatsApp). */
export const WINDOW_DIMENSION: Dimension = {
  key: "window",
  options: [option("window=closed", "Ventana de 24 h de WhatsApp cerrada", (_c, s) => closeWindow(s))],
};
