// Lógica pura de la pantalla del Laboratorio de conversaciones: configuración,
// persistencia en el navegador, traza legible, hilo del teléfono, vista de la
// gestión con sus cambios y resumen para compartir. Sin React ni acceso al DOM
// (el almacenamiento se recibe por parámetro) para poder probarla.

import { caseTypeName, contactTypeName, memberName, stageName, teamName } from "@/lib/flow-lab/catalog";
import type { ScenarioStep } from "@/lib/flow-lab/scenarios/types";
import { currentCase, emptyContact, newCaseTemplate } from "@/lib/flow-lab/state";
import { LAB_CHANNEL_LABELS, type LabCatalog, type LabChannel, type LabMessage, type LabProfile, type LabState, type LabTrace, type TraceStep, type TriggerCandidateTrace } from "@/lib/flow-lab/types";
import { formatDateTime, formatTime } from "@/lib/format";

// ── Configuración de la prueba ──────────────────────────────────────────────

export const CUSTOM_PROFILE_ID = "custom";

export interface CustomProfileInput {
  name: string;
  contactTypeId: string | null;
  /** Etiquetas separadas por comas. */
  tags: string;
  /** ¿Ya existe como contacto? (si no, su primer mensaje dispara la bienvenida) */
  existed: boolean;
  caseTypeId: string | null;
  stageId: string | null;
  /** Escribió hace menos de 24 h (ventana de WhatsApp abierta). Solo si hay gestión inicial. */
  recentInbound: boolean;
}

export interface LabConfig {
  /** Id de un perfil de ejemplo o CUSTOM_PROFILE_ID. */
  profileId: string;
  custom: CustomProfileInput;
  channel: LabChannel;
  /** Flujos que participan (publicados y, si se eligen, borradores). */
  flowIds: string[];
}

export function defaultCustomProfile(catalog: LabCatalog): CustomProfileInput {
  return {
    name: "Cliente de prueba",
    contactTypeId: catalog.contactTypes.find((t) => t.isDefault)?.id ?? null,
    tags: "",
    existed: true,
    caseTypeId: null,
    stageId: null,
    recentInbound: true,
  };
}

export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const tag = part.trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Perfil "personalizado": contacto con nombre, tipo, etiquetas y, si se elige, una gestión abierta. */
export function buildCustomProfile(input: CustomProfileInput, catalog: LabCatalog, nowIso: string): LabProfile {
  const notices: string[] = [];
  const caseType = input.caseTypeId ? catalog.caseTypes.find((t) => t.id === input.caseTypeId) : undefined;
  if (input.caseTypeId && !caseType) notices.push("El tipo de gestión elegido ya no existe: el contacto empieza sin gestión.");
  const stage = caseType?.stages.find((s) => s.id === input.stageId) ?? caseType?.stages.find((s) => s.kind === "open") ?? caseType?.stages[0];
  const cases = [];
  if (caseType) {
    const row = newCaseTemplate("case-1", nowIso);
    row.caseTypeId = caseType.id;
    row.stageId = stage?.id ?? null;
    row.openedAt = nowIso;
    if (input.recentInbound) row.lastInboundAt = new Date(new Date(nowIso).getTime() - 30 * 60_000).toISOString();
    cases.push(row);
  }
  return {
    id: CUSTOM_PROFILE_ID,
    name: "Personalizado",
    description: "Contacto armado a mano.",
    contact: emptyContact({
      name: input.name.trim() || "Cliente de prueba",
      contactTypeId: catalog.contactTypes.some((t) => t.id === input.contactTypeId) ? input.contactTypeId : null,
      tags: parseTags(input.tags),
      existed: input.existed || cases.length > 0,
    }),
    cases,
    messages: [],
    clock: nowIso,
    notices,
  };
}

/** Todos los publicados y, si viene `?flow=`, ese flujo aunque sea borrador. */
export function defaultFlowIds(catalog: LabCatalog, focusFlowId?: string | null): string[] {
  const ids = catalog.flows.filter((f) => f.status === "published").map((f) => f.id);
  if (focusFlowId && catalog.flows.some((f) => f.id === focusFlowId) && !ids.includes(focusFlowId)) ids.push(focusFlowId);
  return ids;
}

// ── Instantáneas de la gestión y el contacto ────────────────────────────────

export interface SnapshotField {
  /** Sección ("Contacto", "Gestión 1 · Venta", "Próximas"). */
  s: string;
  /** Clave estable para comparar entre pasos. */
  k: string;
  /** Etiqueta del dato. */
  l: string;
  /** Valor ya formateado. */
  v: string;
}

function dateOrDash(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : "—";
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
  closed: "Cerrada",
  scheduled: "Programada",
};

/** Datos del contacto y de cada gestión, listos para mostrar y comparar. */
export function snapshotOf(catalog: LabCatalog, state: LabState): SnapshotField[] {
  const out: SnapshotField[] = [];
  const add = (s: string, k: string, l: string, v: string) => out.push({ s, k, l, v });
  const c = state.contact;
  add("Contacto", "contact.name", "Nombre", c.name ?? "—");
  add("Contacto", "contact.type", "Tipo de contacto", contactTypeName(catalog, c.contactTypeId));
  add("Contacto", "contact.tags", "Etiquetas", c.tags.length ? c.tags.join(", ") : "—");
  add("Contacto", "contact.owner", "Responsable", memberName(catalog, c.ownerId));
  add("Contacto", "contact.team", "Equipo", teamName(catalog, c.teamId));
  add("Contacto", "contact.subscribed", "Suscrito a difusiones", c.subscribed ? "Sí" : "No");
  add("Contacto", "contact.keyDate", "Fecha clave", c.keyDate ?? "—");
  for (const [slug, value] of Object.entries(c.customFields)) {
    const def = catalog.customFields.find((f) => f.slug === slug);
    add("Contacto", `contact.field.${slug}`, def?.name ?? slug, value);
  }
  add("Contacto", "contact.bot", "Bot", state.automationPaused ? "En pausa" : "Activo");

  const cases = [...state.cases].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const current = currentCase(state);
  cases.forEach((row, i) => {
    const section = `Gestión ${i + 1} · ${caseTypeName(catalog, row.caseTypeId)}${row.id === current?.id ? " (actual)" : ""}`;
    const type = row.caseTypeId ? catalog.caseTypes.find((t) => t.id === row.caseTypeId) : undefined;
    const key = (f: string) => `case:${row.id}:${f}`;
    add(section, key("type"), "Tipo", caseTypeName(catalog, row.caseTypeId));
    add(section, key("status"), "Estado", STATUS_LABEL[row.status] ?? row.status);
    add(section, key("stage"), "Etapa", stageName(catalog, row.stageId));
    add(section, key("category"), "Categoría", type?.categories.find((x) => x.id === row.categoryId)?.name ?? "—");
    add(section, key("assignee"), "Responsable", memberName(catalog, row.assigneeId));
    add(section, key("team"), "Equipo", teamName(catalog, row.teamId));
    if (row.outcomeReasonId) add(section, key("reason"), "Motivo de cierre", type?.reasons.find((x) => x.id === row.outcomeReasonId)?.name ?? row.outcomeReasonId);
    add(section, key("scheduledFor"), "Programada para", dateOrDash(row.scheduledFor));
    add(section, key("openedAt"), "Abierta", dateOrDash(row.openedAt));
    add(section, key("lastInboundAt"), "Último mensaje del cliente", dateOrDash(row.lastInboundAt));
    add(section, key("lastOutboundAt"), "Última respuesta nuestra", dateOrDash(row.lastOutboundAt));
    add(section, key("waitingSince"), "Cliente esperando desde", dateOrDash(row.waitingSince));
    add(section, key("firstResponseAt"), "Primera respuesta", dateOrDash(row.firstResponseAt));
    add(section, key("closedAt"), "Cerrada", dateOrDash(row.closedAt));
    add(section, key("notes"), "Notas internas", String(row.notes.length));
  });

  const upcoming = "Próximas";
  for (const row of cases) {
    if (row.status === "scheduled" && row.scheduledFor) {
      add(upcoming, `next:case:${row.id}`, `Gestión «${caseTypeName(catalog, row.caseTypeId)}»`, `se activa ${formatDateTime(row.scheduledFor)}`);
    }
  }
  for (const job of state.jobs) {
    if (job.status !== "pending") continue;
    const session = state.sessions.find((x) => x.id === job.sessionId);
    const flow = catalog.flows.find((f) => f.id === session?.flowId);
    add(upcoming, `next:job:${job.id}`, `Espera en «${flow?.name ?? "flujo"}»`, `sigue ${formatDateTime(job.runAt)}`);
  }
  for (const session of state.sessions) {
    if (session.status === "active" && session.waitingForInput) {
      const flow = catalog.flows.find((f) => f.id === session.flowId);
      add(upcoming, `next:input:${session.id}`, `«${flow?.name ?? "flujo"}» espera respuesta`, session.waitingUntil ? `hasta ${formatDateTime(session.waitingUntil)}` : "sin límite");
    }
  }
  return out;
}

export interface DisplayField extends SnapshotField {
  changed: boolean;
  /** Valor anterior cuando cambió (no hay si el dato es nuevo). */
  previous?: string;
}

export interface DisplaySection {
  title: string;
  fields: DisplayField[];
}

/** Agrupa por sección y marca lo que cambió respecto del paso anterior (y lo que desapareció). */
export function diffSnapshots(prev: SnapshotField[] | null, next: SnapshotField[]): DisplaySection[] {
  const before = new Map((prev ?? []).map((f) => [f.k, f.v]));
  const sections = new Map<string, DisplayField[]>();
  for (const f of next) {
    const had = before.has(f.k);
    const changed = prev !== null && (!had || before.get(f.k) !== f.v);
    const field: DisplayField = { ...f, changed, ...(changed && had ? { previous: before.get(f.k) } : {}) };
    const list = sections.get(f.s) ?? [];
    list.push(field);
    sections.set(f.s, list);
  }
  return [...sections.entries()].map(([title, fields]) => ({ title, fields }));
}

/** Etiquetas de los datos que cambiaron (para el aviso "N cambios"). */
export function changedLabels(sections: DisplaySection[]): string[] {
  return sections.flatMap((s) => s.fields.filter((f) => f.changed).map((f) => f.l));
}

// ── Traza legible ───────────────────────────────────────────────────────────

export type Highlight = { flowId: string; nodeIds: string[] }[];

export interface ReadableStep {
  n: number;
  at: string;
  level: TraceStep["level"];
  kind: TraceStep["kind"];
  text: string;
  /** Líneas de detalle (candidatos descartados, condiciones...). */
  details: string[];
  /** Pasos que ocurren dentro del mismo nodo (mensajes, etiquetas, variables...). */
  children: ReadableStep[];
  /** Nodos que ilumina este paso (con sus hijos). */
  highlight: Highlight;
  flowName?: string;
}

function mergeHighlight(into: Map<string, Set<string>>, flowId?: string, nodeId?: string) {
  if (!flowId || !nodeId) return;
  const set = into.get(flowId) ?? new Set<string>();
  set.add(nodeId);
  into.set(flowId, set);
}

function toHighlight(map: Map<string, Set<string>>): Highlight {
  return [...map.entries()].map(([flowId, ids]) => ({ flowId, nodeIds: [...ids] }));
}

function candidateLines(candidates: unknown): string[] {
  if (!Array.isArray(candidates)) return [];
  return (candidates as TriggerCandidateTrace[])
    .filter((c) => c && typeof c.flowName === "string")
    .map((c) => `${c.outcome === "matched" ? "Coincide" : "Descartado"} · ${c.flowName} (${c.description}): ${c.why}`);
}

function stepDetails(step: TraceStep): string[] {
  const data = step.data ?? {};
  switch (step.kind) {
    case "trigger_evaluation":
    case "case_event":
      return candidateLines(data.candidates);
    case "condition": {
      const items = Array.isArray(data.conditions) ? (data.conditions as { description?: string; result?: boolean }[]) : [];
      return items.map((i) => `${i.result ? "Sí" : "No"} · ${i.description ?? "condición"}`);
    }
    case "message_sent": {
      const params = Array.isArray(data.params) ? (data.params as string[]) : [];
      return data.template ? [`Plantilla ${String(data.template)}${params.length ? ` con ${params.map((p) => `«${p}»`).join(", ")}` : ""}`] : [];
    }
    default:
      return [];
  }
}

function stepHighlight(step: TraceStep, into: Map<string, Set<string>>) {
  mergeHighlight(into, step.flowId, step.nodeId);
  if (step.kind === "trigger_evaluation" && step.data?.matched === true) return;
  if ((step.kind === "trigger_evaluation" || step.kind === "case_event") && Array.isArray(step.data?.candidates)) {
    for (const c of step.data.candidates as TriggerCandidateTrace[]) {
      if (c.outcome === "matched") mergeHighlight(into, c.flowId, c.nodeId);
    }
  }
}

/** Reduce los pasos de una traza a filas legibles: los efectos de un nodo cuelgan de la fila del nodo. */
export function readableSteps(trace: Pick<LabTrace, "steps">): ReadableStep[] {
  const rows: ReadableStep[] = [];
  let group: { row: ReadableStep; flowId?: string; nodeId?: string; map: Map<string, Set<string>> } | null = null;

  const build = (step: TraceStep): { row: ReadableStep; map: Map<string, Set<string>> } => {
    const map = new Map<string, Set<string>>();
    stepHighlight(step, map);
    return {
      row: {
        n: step.n,
        at: step.at,
        level: step.level,
        kind: step.kind,
        text: step.text,
        details: stepDetails(step),
        children: [],
        highlight: toHighlight(map),
        flowName: step.flowName,
      },
      map,
    };
  };

  for (const step of trace.steps) {
    if (step.kind === "node") {
      const b = build(step);
      rows.push(b.row);
      group = { row: b.row, flowId: step.flowId, nodeId: step.nodeId, map: b.map };
      continue;
    }
    if (group && step.nodeId && step.nodeId === group.nodeId && step.flowId === group.flowId) {
      const b = build(step);
      group.row.children.push(b.row);
      if (b.row.level === "warning" || b.row.level === "error") {
        group.row.level = b.row.level;
      }
      continue;
    }
    group = null;
    rows.push(build(step).row);
  }
  return rows;
}

/** Nodos recorridos por una traza, agrupados por flujo, en orden y sin repetir. */
export function visitedHighlight(trace: Pick<LabTrace, "visited"> | undefined): Highlight {
  const map = new Map<string, Set<string>>();
  for (const v of trace?.visited ?? []) mergeHighlight(map, v.flowId, v.nodeId);
  return toHighlight(map);
}

export function countWarnings(trace: Pick<LabTrace, "steps">): number {
  return trace.steps.filter((s) => s.level === "warning" || s.level === "error").length;
}

// ── Historial de la prueba ──────────────────────────────────────────────────

export interface LabEntry {
  trace: LabTrace;
  /** Datos del contacto y la gestión después de esta acción. */
  snapshot: SnapshotField[];
  /** La acción como paso de escenario (para «Guardar como escenario»). Las pruebas guardadas antes no lo traen. */
  step?: ScenarioStep;
}

export const MAX_ENTRIES = 60;

export function pushEntry(entries: LabEntry[], entry: LabEntry): LabEntry[] {
  const next = [...entries, entry];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

// ── Hilo del teléfono ───────────────────────────────────────────────────────

export type ThreadItem =
  | { kind: "message"; message: LabMessage }
  | { kind: "separator"; id: string; at: string; label: string };

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = m / 60;
    return Number.isInteger(h) ? `${h} h` : `${Math.floor(h)} h ${m % 60} min`;
  }
  const d = m / (60 * 24);
  return Number.isInteger(d) ? `${d} ${d === 1 ? "día" : "días"}` : `${Math.floor(d)} d ${Math.round((m % (60 * 24)) / 60)} h`;
}

/**
 * Mensajes en orden con separadores: uno por cada "avanzar tiempo" (con cuánto
 * pasó y la hora a la que se llegó) y otro cuando cambia el día.
 */
export function buildThread(messages: readonly LabMessage[], traces: readonly Pick<LabTrace, "action" | "startedAt" | "endedAt" | "title" | "error">[]): ThreadItem[] {
  const items: { at: number; order: number; item: ThreadItem }[] = [];
  messages.forEach((message, i) => items.push({ at: new Date(message.at).getTime(), order: i, item: { kind: "message", message } }));
  traces.forEach((t, i) => {
    if (t.action !== "advanceTime" || t.error) return;
    const minutes = (new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 60_000;
    items.push({
      at: new Date(t.startedAt).getTime(),
      order: 1_000_000 + i,
      item: { kind: "separator", id: `adv-${i}`, at: t.endedAt, label: `Pasaron ${formatMinutes(minutes)} · ${formatDateTime(t.endedAt)}` },
    });
  });
  items.sort((a, b) => a.at - b.at || a.order - b.order);

  const out: ThreadItem[] = [];
  const dayOf = (iso: string) => formatDateTime(iso).split(",")[0];
  let lastDay = "";
  for (const { item } of items) {
    if (item.kind === "message") {
      const day = dayOf(item.message.at);
      if (day !== lastDay) out.push({ kind: "separator", id: `day-${item.message.id}`, at: item.message.at, label: day });
      lastDay = day;
    } else {
      lastDay = dayOf(item.at);
    }
    out.push(item);
  }
  return out;
}

// ── Resumen para compartir ──────────────────────────────────────────────────

function describeMessage(m: LabMessage): string {
  const who = m.author === "client" ? "Cliente" : m.author === "bot" ? `Bot${m.flowName ? ` (${m.flowName})` : ""}` : `Asesor${m.authorName ? ` (${m.authorName})` : ""}`;
  const parts = [m.kind === "template" ? `[Plantilla de WhatsApp${m.template ? ` ${m.template.name}` : ""}] ${m.text}` : m.text];
  if (m.payload && m.author === "client") parts.push(`[pulsó un botón]`);
  const lines = [`[${formatTime(m.at)}] ${who}: ${parts.join(" ")}`];
  if (m.buttons?.length) lines.push(`    Botones: ${m.buttons.map((b) => b.title).join(" | ")}`);
  if (m.quickReplies?.length) lines.push(`    Respuestas rápidas: ${m.quickReplies.map((b) => b.title).join(" | ")}`);
  if (m.carousel?.length) lines.push(`    Carrusel: ${m.carousel.map((c) => c.title).join(" | ")}`);
  if (m.adaptation?.length) lines.push(`    Adaptación al canal: ${m.adaptation.join(" ")}`);
  if (m.failed) lines.push(`    No se pudo enviar: ${m.failed}`);
  return lines.join("\n");
}

const LEVEL_MARK: Record<TraceStep["level"], string> = { info: "-", ok: "+", warning: "!", error: "x" };

function stepLines(step: ReadableStep, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}${LEVEL_MARK[step.level]} ${step.text}`];
  for (const d of step.details) lines.push(`${pad}    · ${d}`);
  for (const child of step.children) lines.push(...stepLines(child, depth + 1));
  return lines;
}

export function buildSummary(input: {
  catalog: LabCatalog;
  state: LabState;
  profileName: string;
  flowNames: string[];
  traces: readonly LabTrace[];
}): string {
  const { catalog, state, traces } = input;
  const lines: string[] = [];
  lines.push(`LABORATORIO DE CONVERSACIONES · ${catalog.workspaceName}`);
  lines.push(`Perfil: ${input.profileName} · Canal: ${LAB_CHANNEL_LABELS[state.channel]} · Reloj simulado: ${formatDateTime(state.clock)}`);
  lines.push(`Flujos que participan: ${input.flowNames.length ? input.flowNames.join(", ") : "ninguno"}`);
  lines.push("");
  lines.push("CONVERSACIÓN");
  if (state.messages.length === 0) lines.push("(sin mensajes)");
  for (const m of state.messages) lines.push(describeMessage(m));
  lines.push("");
  lines.push("TRAZA");
  if (traces.length === 0) lines.push("(sin acciones)");
  traces.forEach((t, i) => {
    lines.push(`${i + 1}. [${formatDateTime(t.startedAt)}] ${t.title}`);
    for (const step of readableSteps(t)) lines.push(...stepLines(step, 1));
    if (t.error) lines.push(`  x ${t.error}`);
  });
  lines.push("");
  lines.push("ESTADO FINAL");
  let section = "";
  for (const f of snapshotOf(catalog, state)) {
    if (f.s !== section) {
      section = f.s;
      lines.push(`${section}:`);
    }
    lines.push(`  ${f.l}: ${f.v}`);
  }
  return lines.join("\n");
}

// ── Persistencia en el navegador ────────────────────────────────────────────

export interface SavedLab {
  version: 1;
  config: LabConfig;
  state: LabState;
  entries: LabEntry[];
  /** Datos después de cargar el perfil, antes de la primera acción. */
  initialSnapshot: SnapshotField[];
  selected: number | null;
}

export const STORAGE_PREFIX = "flow-lab:v1:";

export function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valida lo mínimo para que la pantalla no se rompa con datos viejos o manipulados. */
export function parseSaved(raw: string | null): SavedLab | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data) || data.version !== 1) return null;
    const { config, state, entries, initialSnapshot } = data;
    if (!isObject(config) || typeof config.profileId !== "string" || !Array.isArray(config.flowIds) || !isObject(config.custom)) return null;
    if (!isObject(state) || state.version !== 1 || typeof state.clock !== "string" || !Array.isArray(state.cases) || !Array.isArray(state.messages)) return null;
    if (!Array.isArray(state.sessions) || !Array.isArray(state.jobs) || !isObject(state.contact) || !isObject(state.counters)) return null;
    if (!Array.isArray(entries) || !Array.isArray(initialSnapshot)) return null;
    if (!entries.every((e) => isObject(e) && isObject(e.trace) && Array.isArray((e.trace as Record<string, unknown>).steps) && Array.isArray(e.snapshot))) return null;
    const selected = typeof data.selected === "number" && data.selected >= 0 && data.selected < entries.length ? data.selected : null;
    return {
      version: 1,
      config: config as unknown as LabConfig,
      state: state as unknown as LabState,
      entries: entries as unknown as LabEntry[],
      initialSnapshot: initialSnapshot as SnapshotField[],
      selected,
    };
  } catch {
    return null;
  }
}

export function loadSaved(storage: StorageLike | null, workspaceId: string): SavedLab | null {
  if (!storage) return null;
  try {
    return parseSaved(storage.getItem(storageKey(workspaceId)));
  } catch {
    return null;
  }
}

/** Guarda; si no cabe, reintenta con menos historial. Devuelve false si no se pudo. */
export function saveSaved(storage: StorageLike | null, workspaceId: string, saved: SavedLab): boolean {
  if (!storage) return false;
  let entries = saved.entries;
  let selected = saved.selected;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      storage.setItem(storageKey(workspaceId), JSON.stringify({ ...saved, entries, selected }));
      return true;
    } catch {
      const drop = Math.ceil(entries.length / 2);
      if (entries.length === 0) return false;
      entries = entries.slice(drop);
      selected = selected === null ? null : selected - drop >= 0 ? selected - drop : null;
    }
  }
  return false;
}

export function clearSaved(storage: StorageLike | null, workspaceId: string): void {
  try {
    storage?.removeItem(storageKey(workspaceId));
  } catch {
    // Sin almacenamiento: no hay nada que borrar.
  }
}

/**
 * Ajusta lo guardado al catálogo actual: quita flujos que ya no existen y
 * vuelve al perfil personalizado si el de ejemplo ya no está. Null si lo
 * guardado ya no sirve (por ejemplo, otro espacio con otros tipos).
 */
export function reconcileSaved(saved: SavedLab, catalog: LabCatalog, sampleIds: string[]): SavedLab {
  const flowIds = saved.config.flowIds.filter((id) => catalog.flows.some((f) => f.id === id));
  const profileId = saved.config.profileId === CUSTOM_PROFILE_ID || sampleIds.includes(saved.config.profileId) ? saved.config.profileId : CUSTOM_PROFILE_ID;
  const enabled = saved.state.enabledFlowIds ? saved.state.enabledFlowIds.filter((id) => flowIds.includes(id)) : null;
  return {
    ...saved,
    config: { ...saved.config, profileId, flowIds },
    state: { ...saved.state, enabledFlowIds: enabled ?? flowIds },
  };
}
