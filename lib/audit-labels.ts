// Registro de cambios (Configuración): convierte una fila de `activity` en una
// frase en español claro, un detalle corto y una categoría para los filtros.
//
// Es una función pura (sin base ni React) para probarla con vitest. Reglas:
//   - SOLO se muestran los campos de `meta` que esta lista permite (lista de
//     permitidos, no de prohibidos): una clave, un enlace o cualquier campo nuevo
//     que alguien meta en `meta` por error nunca llega a la pantalla.
//   - Nunca se muestra JSON crudo: una acción desconocida cae en una frase general.
//   - Nunca se nombra a un cliente cuyos datos se eliminaron, ni se copian notas
//     libres de la ficha (podrían tener datos personales).
//
// Si agregas una acción nueva a lib/audit.ts (o un `audit(...)` en case-config),
// agrégala a AUDIT_ACTIONS y a `describeAudit`; la prueba lo exige.

import { ROLE_LABELS } from "@/lib/auth-helpers";
import { formatNumber, pluralize } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";

// ── Categorías (filtro «Tipo de cambio») ───────────────────────────────────

export type AuditCategory = "team" | "config" | "channels" | "contacts" | "broadcasts" | "flows" | "exports";

export const AUDIT_CATEGORIES: { value: AuditCategory; label: string }[] = [
  { value: "team", label: "Equipo y permisos" },
  { value: "config", label: "Configuración" },
  { value: "channels", label: "Canales" },
  { value: "contacts", label: "Clientes y datos" },
  { value: "broadcasts", label: "Difusiones y secuencias" },
  { value: "flows", label: "Flujos" },
  { value: "exports", label: "Exportaciones e importaciones" },
];

export function parseAuditCategory(raw: unknown): AuditCategory | "" {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return AUDIT_CATEGORIES.some((c) => c.value === v) ? (v as AuditCategory) : "";
}

/** Acciones de `config_changed` que existen hoy, con su categoría (la entidad es la que registra el código). */
export const AUDIT_ACTIONS: Record<string, { entity: string; category: AuditCategory }> = {
  // Equipo (lib/actions/team.ts)
  member_created: { entity: "team", category: "team" },
  member_readded: { entity: "team", category: "team" },
  member_removed: { entity: "team", category: "team" },
  member_renamed: { entity: "team", category: "team" },
  member_email_changed: { entity: "team", category: "team" },
  member_role_changed: { entity: "team", category: "team" },
  access_link_copied: { entity: "team", category: "team" },
  access_email_sent: { entity: "team", category: "team" },
  // Equipos de trabajo (lib/actions/teams.ts)
  team_created: { entity: "teams", category: "team" },
  team_renamed: { entity: "teams", category: "team" },
  team_archived: { entity: "teams", category: "team" },
  team_restored: { entity: "teams", category: "team" },
  team_default_changed: { entity: "teams", category: "team" },
  team_assignment_mode_changed: { entity: "teams", category: "team" },
  team_supervisor_skips_changed: { entity: "teams", category: "team" },
  team_member_added: { entity: "teams", category: "team" },
  team_member_removed: { entity: "teams", category: "team" },
  team_member_role_changed: { entity: "teams", category: "team" },
  // Horario, feriados y atención
  hours_changed: { entity: "hours", category: "config" },
  holiday_added: { entity: "hours", category: "config" },
  holiday_removed: { entity: "hours", category: "config" },
  holidays_loaded: { entity: "hours", category: "config" },
  attention_settings_changed: { entity: "attention", category: "config" },
  attention_automation_changed: { entity: "attention", category: "config" },
  // Respuestas compartidas, diccionario y palabras clave
  saved_reply_created: { entity: "saved_reply", category: "config" },
  saved_reply_updated: { entity: "saved_reply", category: "config" },
  saved_reply_deleted: { entity: "saved_reply", category: "config" },
  spell_word_added: { entity: "dictionary", category: "config" },
  spell_word_approved: { entity: "dictionary", category: "config" },
  spell_word_rejected: { entity: "dictionary", category: "config" },
  spell_word_removed: { entity: "dictionary", category: "config" },
  global_keywords_changed: { entity: "workspace", category: "config" },
  // Claves, espacio y correo
  api_key_changed: { entity: "secrets", category: "config" },
  workspace_settings_changed: { entity: "workspace", category: "config" },
  mail_settings_changed: { entity: "mail", category: "config" },
  apply_business_template: { entity: "", category: "config" },
  key_date_label_changed: { entity: "workspace", category: "config" },
  contact_type_inactivity_changed: { entity: "workspace", category: "config" },
  // Gestiones (lib/actions/case-config.ts)
  case_type_created: { entity: "case_type", category: "config" },
  case_type_updated: { entity: "case_type", category: "config" },
  case_types_reordered: { entity: "case_type", category: "config" },
  case_type_archived: { entity: "case_type", category: "config" },
  case_type_restored: { entity: "case_type", category: "config" },
  case_type_deleted: { entity: "case_type", category: "config" },
  auto_template_changed: { entity: "case_type", category: "config" },
  stage_created: { entity: "stage", category: "config" },
  stage_updated: { entity: "stage", category: "config" },
  stage_reordered: { entity: "stage", category: "config" },
  stage_archived: { entity: "stage", category: "config" },
  stage_restored: { entity: "stage", category: "config" },
  stage_deleted: { entity: "stage", category: "config" },
  category_created: { entity: "category", category: "config" },
  category_updated: { entity: "category", category: "config" },
  category_reordered: { entity: "category", category: "config" },
  category_archived: { entity: "category", category: "config" },
  category_restored: { entity: "category", category: "config" },
  category_deleted: { entity: "category", category: "config" },
  reason_created: { entity: "reason", category: "config" },
  reason_updated: { entity: "reason", category: "config" },
  reason_reordered: { entity: "reason", category: "config" },
  reason_archived: { entity: "reason", category: "config" },
  reason_restored: { entity: "reason", category: "config" },
  reason_deleted: { entity: "reason", category: "config" },
  rule_created: { entity: "rule", category: "config" },
  rule_updated: { entity: "rule", category: "config" },
  rule_enabled: { entity: "rule", category: "config" },
  rule_disabled: { entity: "rule", category: "config" },
  rules_reordered: { entity: "rule", category: "config" },
  rule_deleted: { entity: "rule", category: "config" },
  contact_type_created: { entity: "contact_type", category: "config" },
  contact_type_updated: { entity: "contact_type", category: "config" },
  contact_type_default_changed: { entity: "contact_type", category: "config" },
  contact_types_reordered: { entity: "contact_type", category: "config" },
  contact_type_archived: { entity: "contact_type", category: "config" },
  contact_type_restored: { entity: "contact_type", category: "config" },
  contact_type_deleted: { entity: "contact_type", category: "config" },
  // Canales
  channel_connect_started: { entity: "channel", category: "channels" },
  channels_synced: { entity: "channel", category: "channels" },
  channel_deleted: { entity: "channel", category: "channels" },
  channel_toggled: { entity: "channel", category: "channels" },
  // Difusiones
  broadcast_launched: { entity: "broadcast", category: "broadcasts" },
  broadcast_paused: { entity: "broadcast", category: "broadcasts" },
  broadcast_resumed: { entity: "broadcast", category: "broadcasts" },
  broadcast_cancelled: { entity: "broadcast", category: "broadcasts" },
  broadcast_auto_paused: { entity: "broadcast", category: "broadcasts" },
  // Secuencias (se muestran junto con las difusiones)
  sequence_created: { entity: "sequence", category: "broadcasts" },
  sequence_activated: { entity: "sequence", category: "broadcasts" },
  sequence_paused: { entity: "sequence", category: "broadcasts" },
  sequence_edited: { entity: "sequence", category: "broadcasts" },
  sequence_deleted: { entity: "sequence", category: "broadcasts" },
  sequence_contact_enrolled: { entity: "sequence", category: "broadcasts" },
  // Flujos
  flow_published: { entity: "flow", category: "flows" },
  flow_deleted: { entity: "flow", category: "flows" },
  // Exportaciones
  data_exported: { entity: "export", category: "exports" },
  source_downloaded: { entity: "source_code", category: "exports" },
};

/** Categoría de una entidad desconocida (para acciones nuevas que aún no están en la lista). */
const ENTITY_CATEGORY: Record<string, AuditCategory> = {
  team: "team",
  teams: "team",
  channel: "channels",
  broadcast: "broadcasts",
  sequence: "broadcasts",
  flow: "flows",
  export: "exports",
  source_code: "exports",
};

/** Tipos de `activity` que son de auditoría por sí mismos (no son config_changed). */
export const AUDIT_CONTACT_TYPES = [
  "contact_data_corrected",
  "contact_data_exported",
  "contact_data_erased",
  "contact_data_erase_files_retried",
] as const;
/** Altas y bajas de publicidad: solo cuentan las que anotó una persona (actor_id no nulo). */
export const AUDIT_CONSENT_TYPES = ["contact_subscribed", "contact_unsubscribed"] as const;

/**
 * Filtro de PostgREST (`.or(...)`) con las filas que muestra la pantalla. DEBE ser el mismo
 * filtro que el índice parcial idx_activity_audit_log (supabase/migrations/00049): el orden de
 * los tipos importa para que Postgres reconozca que el índice sirve.
 */
export const AUDIT_ROW_FILTER =
  "type.in.(config_changed,contacts_imported,contact_data_corrected,contact_data_exported,contact_data_erased,contact_data_erase_files_retried)," +
  "and(type.in.(contact_subscribed,contact_unsubscribed),actor_id.not.is.null)";

/** Filtro `.or(...)` extra para una categoría (se suma con AND al filtro base). */
export function auditCategoryFilter(category: AuditCategory): string {
  const actions = Object.entries(AUDIT_ACTIONS)
    .filter(([, v]) => v.category === category)
    .map(([k]) => k);
  const parts: string[] = [];
  if (actions.length > 0) parts.push(`and(type.eq.config_changed,meta->>action.in.(${actions.join(",")}))`);
  if (category === "contacts") parts.push(`type.in.(${[...AUDIT_CONTACT_TYPES, ...AUDIT_CONSENT_TYPES].join(",")})`);
  if (category === "exports") parts.push("type.eq.contacts_imported");
  return parts.join(",");
}

// ── Lectura segura de `meta` ───────────────────────────────────────────────

const MAX_TEXT = 120;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function quote(name: string | null | undefined): string | null {
  return name ? `«${name}»` : null;
}

function roleText(role: unknown): string | null {
  const r = text(role);
  return r ? (ROLE_LABELS[r] ?? null) : null;
}

const plural = pluralize;

// ── Entrada y salida ───────────────────────────────────────────────────────

export interface AuditRowInput {
  type: string;
  from_value: string | null;
  to_value: string | null;
  meta: unknown;
}

export interface AuditLabelContext {
  /** Nombres de personas por id (para «a quién» se refiere el cambio). */
  people?: Record<string, string | undefined>;
  broadcasts?: Record<string, string | undefined>;
  channels?: Record<string, string | undefined>;
  flows?: Record<string, string | undefined>;
  /** Nombre del cliente. NO se usa en filas de datos eliminados ni se carga para clientes eliminados. */
  contactName?: string | null;
}

export interface AuditDescription {
  /** La frase principal. */
  title: string;
  /** Líneas del detalle desplegable (puede ser vacío). */
  details: string[];
  category: AuditCategory | null;
  /** false cuando la acción no se conoce y se usó la frase de respaldo. */
  known: boolean;
}

/** Ids que hay que buscar en la base para armar las frases de un grupo de filas. */
export function auditLookupIds(rows: readonly { meta: unknown }[]): {
  people: string[];
  broadcasts: string[];
  channels: string[];
  flows: string[];
} {
  const sets = { people: new Set<string>(), broadcasts: new Set<string>(), channels: new Set<string>(), flows: new Set<string>() };
  const id = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  for (const row of rows) {
    const m = obj(row.meta);
    const user = id(m.user_id);
    if (user) sets.people.add(user);
    const b = id(m.broadcast_id);
    if (b) sets.broadcasts.add(b);
    const c = id(m.channel_id);
    if (c) sets.channels.add(c);
    const f = id(m.flow_id);
    if (f) sets.flows.add(f);
  }
  return {
    people: [...sets.people],
    broadcasts: [...sets.broadcasts],
    channels: [...sets.channels],
    flows: [...sets.flows],
  };
}

// ── Etiquetas de campos de configuración ───────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  color: "Color",
  description: "Descripción",
  icon: "Icono",
  guide_text: "Guía para el asesor",
  next_steps: "Siguientes pasos",
  strict_order: "Obligar a seguir el orden de las etapas",
  require_category: "Categoría obligatoria",
  require_outcome_reason: "Motivo obligatorio al cerrar",
  is_proactive: "Gestión proactiva",
  is_high_priority: "Prioridad alta",
  routing: "Reparto",
  fixed_team_id: "Equipo de destino",
  sla_first_response_minutes: "Primera respuesta (minutos)",
  sla_resolution_hours: "Resolución (horas)",
  solution_deadline_hours: "Plazo de la solución (horas)",
  reopen_window_days: "Días para reabrir",
  kind: "Clase",
  requires: "Se exige al pasar a esta etapa",
  suggested_for_contact_type_ids: "Sugerido para tipos de contacto",
  auto_template: "Plantilla automática",
};

const VALUE_LABELS: Record<string, string> = {
  contact_owner: "Responsable del contacto",
  contact_team: "Equipo del contacto",
  fixed_team: "Equipo fijo",
  open: "Abierta",
  won: "Ganada",
  lost: "Perdida",
  resolved: "Resuelta",
  category: "Categoría",
  solution: "Solución",
  note: "Nota",
};

function shownValue(value: unknown): string | null {
  if (value === null || value === undefined) return "sin valor";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : null;
  if (typeof value === "string") {
    const t = text(value);
    if (!t) return "sin valor";
    return VALUE_LABELS[t] ?? t;
  }
  return null; // listas y objetos: no se copian
}

/** Líneas «Campo: antes → ahora» de un `changes` {campo: {from, to}} con solo campos permitidos. */
function changeLines(changes: unknown): string[] {
  const lines: string[] = [];
  for (const [field, raw] of Object.entries(obj(changes))) {
    const label = FIELD_LABELS[field];
    if (!label) continue;
    const pair = obj(raw);
    const from = shownValue(pair.from);
    const to = shownValue(pair.to);
    if (field === "name" || field === "description" || field === "guide_text") {
      if (from !== null && to !== null) lines.push(`${label}: ${from} → ${to}`);
    } else if (from !== null && to !== null && field !== "fixed_team_id") {
      lines.push(`${label}: ${from} → ${to}`);
    } else {
      lines.push(`${label}: se cambió`);
    }
  }
  return lines;
}

// ── Cambios con antes → después (horario, atención, equipos...) ───────────

function has(m: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(m, key);
}

const DAY_ORDER: [string, string][] = [
  ["mon", "Lunes"],
  ["tue", "Martes"],
  ["wed", "Miércoles"],
  ["thu", "Jueves"],
  ["fri", "Viernes"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
];

/** «09:00-21:00, 14:00-18:00» → «09:00–21:00, 14:00–18:00». */
function hoursText(value: unknown): string {
  const t = text(value);
  return t ? t.replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, "$1–$2") : "Cerrado";
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-07-06» → «6 de julio de 2026» (sin pasar por zonas horarias). */
function dateText(value: unknown): string | null {
  const t = text(value);
  const match = t ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t) : null;
  if (!match) return null;
  const month = MONTH_NAMES[Number(match[2]) - 1];
  return month ? `${Number(match[3])} de ${month} de ${match[1]}` : null;
}

const VISIBILITY_LABELS: Record<string, string> = {
  own: "Solo sus gestiones",
  own_and_unassigned: "Las suyas y las sin asignar de su equipo",
  team: "Todas las de su equipo",
};

const ASSIGNMENT_LABELS: Record<string, string> = {
  round_robin: "Por turnos",
  least_load: "Al de menor carga",
  manual: "Manual",
};

const TEAM_ROLE_LABELS: Record<string, string> = { supervisor: "Supervisor", agent: "Asesor" };

function labelOf(table: Record<string, string>, value: unknown): string | null {
  const t = text(value);
  return t ? (table[t] ?? null) : null;
}

function yesNo(value: unknown): string | null {
  return typeof value === "boolean" ? (value ? "Sí" : "No") : null;
}

/** «Etiqueta: antes → después» si el cambio trae los dos valores (`<campo>_from` y `<campo>_to`). */
function pairLine(
  m: Record<string, unknown>,
  field: string,
  label: string,
  show: (value: unknown) => string | null,
): string | null {
  if (!has(m, `${field}_from`) || !has(m, `${field}_to`)) return null;
  const a = show(m[`${field}_from`]);
  const b = show(m[`${field}_to`]);
  return a !== null && b !== null ? `${label}: ${a} → ${b}` : null;
}

function compact(lines: (string | null)[]): string[] {
  return lines.filter((l): l is string => l !== null);
}

function minutesText(value: unknown): string | null {
  const n = count(value);
  return n === null ? "Desactivada" : plural(n, "minuto", "minutos");
}

/** Dónde aplica un feriado o una respuesta: la empresa o un equipo. */
function appliesTo(m: Record<string, unknown>): string {
  const team = text(m.team_name);
  return team ? `al equipo ${quote(team)}` : "a toda la empresa";
}

// ── Frases ─────────────────────────────────────────────────────────────────

const ITEM_NOUN: Record<string, { one: string; article: "la" | "el"; list: string }> = {
  stage: { one: "etapa", article: "la", list: "las etapas" },
  category: { one: "categoría", article: "la", list: "las categorías" },
  reason: { one: "motivo", article: "el", list: "los motivos" },
};

const VERB: Record<string, string> = {
  created: "Creó",
  updated: "Cambió",
  archived: "Archivó",
  restored: "Restauró",
  deleted: "Eliminó",
};

/** Frase del tipo «Creó la etapa «X» del tipo de gestión «Y»». */
function itemTitle(
  verb: string,
  noun: string,
  article: "la" | "el" | "un" | "una",
  name: string | null,
  caseType: string | null,
): string {
  const parent = caseType ? ` del tipo de gestión ${quote(caseType)}` : "";
  return `${verb} ${article} ${noun}${name ? ` ${quote(name)}` : ""}${parent}`;
}

function describeConfig(
  action: string,
  row: AuditRowInput,
  m: Record<string, unknown>,
  ctx: AuditLabelContext,
): { title: string; details: string[] } | null {
  const person = (() => {
    const id = text(m.user_id);
    return (id && ctx.people?.[id]) || null;
  })();
  const name = text(m.name);
  const caseType = text(m.case_type);
  const from = text(row.from_value);
  const to = text(row.to_value);
  const details: string[] = [];
  const sessions = m.sessions_revoked === true;

  switch (action) {
    // ── Equipo ──
    case "member_created": {
      const who = person ?? text(m.email) ?? "una persona";
      const role = roleText(row.to_value) ?? roleText(m.role);
      if (text(m.email) && person) details.push(`Correo: ${text(m.email)}`);
      return { title: `Creó el usuario ${who}${role ? ` con el rol ${role}` : ""}`, details };
    }
    case "member_readded": {
      const who = person ?? text(m.email) ?? "una persona";
      const role = roleText(row.to_value) ?? roleText(m.role);
      if (text(m.email) && person) details.push(`Correo: ${text(m.email)}`);
      if (typeof m.reset_link_sent === "boolean") {
        details.push(m.reset_link_sent ? "Se le envió un enlace de acceso por correo" : "No se le envió enlace de acceso por correo");
      }
      return { title: `Volvió a agregar a ${who} al equipo${role ? ` como ${role}` : ""}`, details };
    }
    case "member_removed": {
      // El nombre se guardó al quitarla (las filas antiguas no lo tienen: se usa la frase general).
      const who = text(m.name) ?? person ?? "una persona";
      const role = roleText(row.from_value) ?? roleText(m.role);
      if (text(m.email)) details.push(`Correo: ${text(m.email)}`);
      if (role) details.push(`Rol que tenía: ${role}`);
      if (sessions) details.push("Se cerraron sus sesiones abiertas");
      return { title: `Quitó a ${who} del equipo`, details };
    }
    case "member_renamed": {
      if (sessions) details.push("Se cerraron sus sesiones abiertas");
      return {
        title: from && to ? `Cambió el nombre de ${from} a ${to}` : `Cambió el nombre de ${person ?? "una persona"}`,
        details,
      };
    }
    case "member_email_changed": {
      if (from && to) details.push(`Correo: ${from} → ${to}`);
      if (sessions) details.push("Se cerraron sus sesiones abiertas");
      return { title: `Cambió el correo de ${person ?? "una persona"}`, details };
    }
    case "member_role_changed": {
      const a = roleText(row.from_value);
      const b = roleText(row.to_value);
      if (sessions) details.push("Se cerraron sus sesiones abiertas");
      return {
        title: `Cambió el rol de ${person ?? "una persona"}${a && b ? ` de ${a} a ${b}` : b ? ` a ${b}` : ""}`,
        details,
      };
    }
    case "access_link_copied": {
      const role = roleText(m.target_role);
      if (role) details.push(`Rol de la persona: ${role}`);
      return { title: `Copió el enlace de acceso de ${person ?? "una persona"}`, details };
    }
    case "access_email_sent": {
      const role = roleText(m.target_role);
      if (role) details.push(`Rol de la persona: ${role}`);
      if (typeof m.email_sent === "boolean") details.push(m.email_sent ? "El correo se envió" : "El correo no se pudo enviar");
      return { title: `Envió el acceso por correo a ${person ?? "una persona"}`, details };
    }

    // ── Horario, feriados y atención ──
    case "hours_changed": {
      const team = text(m.team_name);
      for (const [key, label] of DAY_ORDER) {
        if (has(m, `day_${key}_from`) && has(m, `day_${key}_to`)) {
          details.push(`${label}: ${hoursText(m[`day_${key}_from`])} → ${hoursText(m[`day_${key}_to`])}`);
        }
      }
      if (m.uses_company_hours === true) details.push("Ahora usa el horario de la empresa");
      if (m.uses_company_hours === false) details.push("Ahora tiene un horario propio");
      return {
        title: text(m.scope) === "team" ? `Cambió el horario de atención del equipo${team ? ` ${quote(team)}` : ""}` : "Cambió el horario de atención de la empresa",
        details,
      };
    }
    case "holiday_added":
    case "holiday_removed": {
      const date = dateText(m.date);
      details.push(`Aplica ${appliesTo(m)}`);
      return {
        title: `${action === "holiday_added" ? "Añadió" : "Quitó"} el feriado${name ? ` ${quote(name)}` : ""}${date ? ` (${date})` : ""}`,
        details,
      };
    }
    case "holidays_loaded": {
      const year = count(m.year);
      const added = count(m.added);
      if (added !== null) details.push(`${plural(added, "feriado agregado", "feriados agregados")}`);
      details.push(`Aplica ${appliesTo(m)}`);
      return { title: `Cargó los feriados de Perú${year !== null ? ` de ${year}` : ""}`, details };
    }
    case "attention_settings_changed": {
      details.push(
        ...compact([
          pairLine(m, "visibility", "Qué gestiones ve el asesor", (v) => labelOf(VISIBILITY_LABELS, v)),
          pairLine(m, "assignment", "Reparto cuando no hay equipos", (v) => labelOf(ASSIGNMENT_LABELS, v)),
          pairLine(m, "return_queue", "El asesor puede devolver gestiones a la cola", yesNo),
          pairLine(m, "stale_days", "Días en la misma etapa para marcar una gestión como atrasada", (v) => {
            const n = count(v);
            return n === null ? null : formatNumber(n);
          }),
        ]),
      );
      return { title: "Cambió los ajustes de atención", details };
    }
    case "attention_automation_changed": {
      details.push(
        ...compact([
          pairLine(m, "off_hours_enabled", "Respuesta fuera de horario", (v) => (typeof v === "boolean" ? (v ? "Activada" : "Desactivada") : null)),
          m.off_hours_text_changed === true ? "Se cambió el texto de la respuesta fuera de horario (no se guarda en el registro)" : null,
          pairLine(m, "min_hours", "Horas entre respuestas fuera de horario", (v) => {
            const n = count(v);
            return n === null ? "una sola vez por gestión" : plural(n, "hora", "horas");
          }),
          pairLine(m, "reassign_minutes", "Reasignación por espera", minutesText),
        ]),
      );
      return { title: "Cambió la atención automática", details };
    }
    case "global_keywords_changed": {
      const added = text(m.added);
      const removed = text(m.removed);
      const changed = text(m.changed);
      if (added) details.push(`Agregó: ${added}`);
      if (removed) details.push(`Quitó: ${removed}`);
      if (changed) details.push(`Cambió de acción: ${changed}`);
      const total = count(m.total);
      if (total !== null) details.push(`Quedan ${plural(total, "palabra", "palabras")}`);
      return { title: "Cambió las palabras clave globales del espacio", details };
    }

    // ── Equipos de trabajo ──
    case "team_created":
      return { title: quote(text(m.team_name) ?? to) ? `Creó el equipo ${quote(text(m.team_name) ?? to)}` : "Creó un equipo", details };
    case "team_renamed":
      return { title: from && to ? `Cambió el nombre del equipo ${quote(from)} a ${quote(to)}` : `Cambió el nombre de un equipo`, details };
    case "team_archived":
    case "team_restored": {
      const team = quote(text(m.team_name));
      return { title: `${action === "team_archived" ? "Archivó" : "Restauró"} el equipo${team ? ` ${team}` : ""}`, details };
    }
    case "team_default_changed": {
      const team = quote(text(m.team_name) ?? to);
      if (from) details.push(`Antes era ${quote(from)}`);
      return { title: team ? `Marcó el equipo ${team} como equipo por defecto` : "Cambió el equipo por defecto", details };
    }
    case "team_assignment_mode_changed": {
      const team = quote(text(m.team_name));
      const a = labelOf(ASSIGNMENT_LABELS, row.from_value);
      const b = labelOf(ASSIGNMENT_LABELS, row.to_value);
      if (a && b) details.push(`Modo de reparto: ${a} → ${b}`);
      return { title: `Cambió el modo de reparto del equipo${team ? ` ${team}` : ""}`, details };
    }
    case "team_supervisor_skips_changed": {
      const team = quote(text(m.team_name));
      if (to === "on" || to === "off") details.push(`El supervisor no recibe chats: ${to === "on" ? "No → Sí" : "Sí → No"}`);
      return { title: `Cambió si el supervisor recibe chats en el equipo${team ? ` ${team}` : ""}`, details };
    }
    case "team_member_added":
    case "team_member_removed": {
      const team = quote(text(m.team_name));
      const role = labelOf(TEAM_ROLE_LABELS, action === "team_member_added" ? row.to_value : row.from_value);
      if (role) details.push(action === "team_member_added" ? `Rol en el equipo: ${role}` : `Rol que tenía en el equipo: ${role}`);
      const who = person ?? "una persona";
      return {
        title: action === "team_member_added" ? `Añadió a ${who} al equipo${team ? ` ${team}` : ""}` : `Quitó a ${who} del equipo${team ? ` ${team}` : ""}`,
        details,
      };
    }
    case "team_member_role_changed": {
      const team = quote(text(m.team_name));
      const a = labelOf(TEAM_ROLE_LABELS, row.from_value);
      const b = labelOf(TEAM_ROLE_LABELS, row.to_value);
      return {
        title: `Cambió el rol de ${person ?? "una persona"} en el equipo${team ? ` ${team}` : ""}${a && b ? ` de ${a} a ${b}` : b ? ` a ${b}` : ""}`,
        details,
      };
    }

    // ── Respuestas guardadas compartidas (nunca se guarda el texto) ──
    case "saved_reply_created":
    case "saved_reply_updated":
    case "saved_reply_deleted": {
      const team = text(m.team_name);
      const where = text(m.scope) === "team" ? (team ? ` del equipo ${quote(team)}` : " de un equipo") : " de la empresa";
      if (action === "saved_reply_updated") {
        if (from && to) details.push(`Título: ${from} → ${to}`);
        if (text(m.fields)) details.push(`Se cambió: ${text(m.fields)} (el texto no se guarda en el registro)`);
      }
      const verb = action === "saved_reply_created" ? "Creó" : action === "saved_reply_updated" ? "Cambió" : "Eliminó";
      return { title: `${verb} la respuesta guardada${name ? ` ${quote(name)}` : ""}${where}`, details };
    }

    // ── Diccionario de la tienda ──
    case "spell_word_added":
    case "spell_word_approved":
    case "spell_word_rejected":
    case "spell_word_removed": {
      const word = quote(text(m.word) ?? to) ?? "una palabra";
      switch (action) {
        case "spell_word_added":
          return { title: `Agregó ${word} al diccionario de la tienda`, details };
        case "spell_word_approved":
          return { title: `Aprobó ${word} para el diccionario de la tienda`, details };
        case "spell_word_rejected":
          return { title: `Rechazó el pedido de agregar ${word} al diccionario de la tienda`, details };
        default:
          return { title: `Quitó ${word} del diccionario de la tienda`, details };
      }
    }

    // ── Secuencias (solo el nombre y cuántos pasos; nunca el texto de un paso) ──
    case "sequence_created":
    case "sequence_activated":
    case "sequence_paused":
    case "sequence_deleted": {
      const ref = name ? ` ${quote(name)}` : "";
      const verb = { sequence_created: "Creó", sequence_activated: "Activó", sequence_paused: "Pausó", sequence_deleted: "Eliminó" }[action];
      return { title: `${verb} la secuencia${ref}`, details };
    }
    case "sequence_contact_enrolled": {
      // Inscripción hecha a mano. No se nombra al cliente: queda en su propio historial.
      if (m.reactivated === true) details.push("Volvió a entrar: su inscripción anterior estaba terminada o cancelada");
      return { title: `Inscribió a un contacto en la secuencia${name ? ` ${quote(name)}` : ""}`, details };
    }
    case "sequence_edited": {
      if (from && to) details.push(`Nombre: ${from} → ${to}`);
      const a = count(m.steps_from);
      const b = count(m.steps_to);
      if (a !== null && b !== null) details.push(`Pasos: ${a} → ${b}`);
      if (text(m.fields)) details.push(`Se cambió: ${text(m.fields)}`);
      return { title: `Cambió la secuencia${name ? ` ${quote(name)}` : ""}`, details };
    }

    // ── Claves, espacio y correo ──
    case "api_key_changed": {
      const zernio = m.zernio === true;
      const ai = m.ai === true;
      const which = zernio && ai ? "las claves de Zernio y de la IA" : ai ? "la clave de la IA" : zernio ? "la clave de Zernio" : "una clave de API";
      details.push("Por seguridad, el valor de la clave no se guarda en el registro");
      return { title: `Cambió ${which}`, details };
    }
    case "workspace_settings_changed": {
      const field = text(m.field);
      if (field === "name" || !field) {
        return {
          title: from && to ? `Cambió el nombre del espacio de «${from}» a «${to}»` : "Cambió el nombre del espacio de trabajo",
          details,
        };
      }
      return { title: "Cambió la configuración general del espacio", details };
    }
    case "mail_settings_changed": {
      const host = text(m.new_host);
      const prevHost = text(m.previous_host);
      const port = count(m.new_port);
      const prevPort = count(m.previous_port);
      const fromEmail = text(m.new_from_email);
      const prevFromEmail = text(m.previous_from_email);
      if (host || prevHost) details.push(`Servidor: ${prevHost ?? "sin configurar"} → ${host ?? "sin configurar"}`);
      if (port !== null || prevPort !== null) details.push(`Puerto: ${prevPort ?? "sin configurar"} → ${port ?? "sin configurar"}`);
      if (fromEmail || prevFromEmail) details.push(`Correo de envío: ${prevFromEmail ?? "sin configurar"} → ${fromEmail ?? "sin configurar"}`);
      if (m.password_changed === true) details.push("Se cambió la contraseña del correo (no se guarda en el registro)");
      return { title: "Cambió el servidor de correo (SMTP) de la app", details };
    }
    case "apply_business_template": {
      const names: Record<string, string> = { ecommerce: "E-commerce", gym: "Gimnasio", general: "General", blank: "En blanco" };
      const key = text(row.to_value);
      const label = key ? (names[key] ?? null) : null;
      const added = obj(m.added);
      const parts: [string, string, string][] = [
        ["caseTypes", "tipo de gestión", "tipos de gestión"],
        ["stages", "etapa", "etapas"],
        ["categories", "categoría", "categorías"],
        ["reasons", "motivo", "motivos"],
        ["rules", "regla", "reglas"],
        ["contactTypes", "tipo de contacto", "tipos de contacto"],
      ];
      const lines = parts.flatMap(([k, one, many]) => {
        const n = count(added[k]);
        return n && n > 0 ? [plural(n, one, many)] : [];
      });
      details.push(lines.length ? `Se agregaron: ${lines.join(", ")}` : "No se agregó nada nuevo (ya estaba todo)");
      return { title: `Aplicó la plantilla de negocio${label ? ` ${quote(label)}` : ""}`, details };
    }
    case "key_date_label_changed": {
      if (from && to) return { title: `Cambió el nombre de la fecha clave de «${from}» a «${to}»`, details };
      if (to) return { title: `Puso el nombre «${to}» a la fecha clave de los contactos`, details };
      return { title: "Quitó el nombre personalizado de la fecha clave de los contactos", details };
    }
    case "contact_type_inactivity_changed": {
      if (from && to) details.push(`Aviso de inactividad: ${from} → ${to}`);
      return { title: "Cambió el aviso de clientes inactivos", details };
    }

    // ── Gestiones: tipos ──
    case "case_type_created":
      return { title: `Creó el tipo de gestión${name ? ` ${quote(name)}` : ""}`, details };
    case "case_type_updated": {
      details.push(...changeLines(m.changes));
      return { title: `Cambió el tipo de gestión${name ? ` ${quote(name)}` : ""}`, details };
    }
    case "case_types_reordered":
      return { title: "Cambió el orden de los tipos de gestión", details };
    case "case_type_archived":
      return { title: `Archivó el tipo de gestión${name ? ` ${quote(name)}` : ""}`, details: usageDetails(m) };
    case "case_type_restored":
      return { title: `Restauró el tipo de gestión${name ? ` ${quote(name)}` : ""}`, details };
    case "case_type_deleted":
      return { title: `Eliminó el tipo de gestión${name ? ` ${quote(name)}` : ""}`, details };
    case "auto_template_changed": {
      const target = name ? ` del tipo de gestión ${quote(name)}` : "";
      if (to) {
        details.push(`Plantilla: ${to}`);
        return { title: `Cambió la plantilla automática${target}`, details };
      }
      return { title: `Quitó la plantilla automática${target}`, details };
    }

    // ── Gestiones: reglas ──
    case "rule_created":
      return { title: `Creó una regla${inType(caseType)}`, details };
    case "rule_updated":
      return { title: `Cambió una regla${inType(caseType)}`, details };
    case "rule_enabled":
      return { title: `Activó una regla${inType(caseType)}`, details };
    case "rule_disabled":
      return { title: `Desactivó una regla${inType(caseType)}`, details };
    case "rules_reordered":
      return { title: `Cambió el orden de las reglas${inType(caseType)}`, details };
    case "rule_deleted":
      return { title: `Eliminó una regla${inType(caseType)}`, details };

    // ── Gestiones: tipos de contacto ──
    case "contact_type_created":
      return { title: `Creó el tipo de contacto${name ? ` ${quote(name)}` : ""}`, details };
    case "contact_type_updated": {
      details.push(...changeLines(m.changes));
      return { title: `Cambió el tipo de contacto${name ? ` ${quote(name)}` : ""}`, details };
    }
    case "contact_type_default_changed": {
      if (to) {
        return {
          title: from ? `Cambió el tipo de contacto por defecto de ${quote(from)} a ${quote(to)}` : `Puso ${quote(to)} como tipo de contacto por defecto`,
          details,
        };
      }
      return { title: "Quitó el tipo de contacto por defecto", details };
    }
    case "contact_types_reordered":
      return { title: "Cambió el orden de los tipos de contacto", details };
    case "contact_type_archived":
      return { title: `Archivó el tipo de contacto${name ? ` ${quote(name)}` : ""}`, details: usageDetails(m) };
    case "contact_type_restored":
      return { title: `Restauró el tipo de contacto${name ? ` ${quote(name)}` : ""}`, details };
    case "contact_type_deleted":
      return { title: `Eliminó el tipo de contacto${name ? ` ${quote(name)}` : ""}`, details };

    // ── Canales ──
    case "channel_connect_started": {
      const platform = text(m.platform);
      return { title: platform ? `Empezó a conectar un canal de ${platformLabel(platform)}` : "Empezó a conectar un canal", details };
    }
    case "channels_synced": {
      const created = count(m.created) ?? 0;
      const deactivated = count(m.deactivated) ?? 0;
      const updated = count(m.updated) ?? 0;
      details.push(`${plural(created, "canal nuevo", "canales nuevos")}`);
      details.push(`${plural(deactivated, "canal desactivado", "canales desactivados")}`);
      details.push(`${plural(updated, "canal actualizado", "canales actualizados")}`);
      return { title: "Sincronizó los canales con Zernio", details };
    }
    case "channel_deleted": {
      const channelName = text(m.channel_name);
      const platform = text(m.platform);
      if (platform) details.push(`Red: ${platformLabel(platform)}`);
      return { title: channelName ? `Eliminó el canal ${quote(channelName)}` : "Eliminó un canal", details };
    }
    case "channel_toggled": {
      const id = text(m.channel_id);
      const channel = (id && ctx.channels?.[id]) || null;
      const verb = row.to_value === "off" ? "Desactivó" : "Activó";
      return { title: `${verb} ${channel ? `el canal ${quote(channel)}` : "un canal"}`, details };
    }

    // ── Difusiones ──
    case "broadcast_launched":
    case "broadcast_paused":
    case "broadcast_resumed":
    case "broadcast_cancelled":
    case "broadcast_auto_paused": {
      const id = text(m.broadcast_id);
      const b = (id && ctx.broadcasts?.[id]) || null;
      const ref = b ? `la difusión ${quote(b)}` : "una difusión";
      if (action === "broadcast_launched") {
        const recipients = count(m.recipients);
        const excluded = count(m.excluded);
        if (recipients !== null) details.push(`Destinatarios: ${formatNumber(recipients)}`);
        if (excluded !== null && excluded > 0) details.push(`Excluidos: ${formatNumber(excluded)}`);
        return { title: `Lanzó ${ref}`, details };
      }
      const sent = count(m.sent);
      const pending = count(m.pending);
      const failed = count(m.failed);
      if (sent !== null) details.push(`Enviados: ${formatNumber(sent)}`);
      if (pending !== null) details.push(`Pendientes: ${formatNumber(pending)}`);
      if (failed !== null && failed > 0) details.push(`Con error: ${formatNumber(failed)}`);
      if (action === "broadcast_auto_paused") {
        const streak = count(m.consecutive_failures);
        if (streak !== null) details.push(`Errores seguidos antes de pausarse: ${formatNumber(streak)}`);
        return { title: `Se pausó sola ${ref} por errores seguidos`, details };
      }
      const verb = action === "broadcast_paused" ? "Pausó" : action === "broadcast_resumed" ? "Reanudó" : "Canceló";
      return { title: `${verb} ${ref}`, details };
    }

    // ── Flujos ──
    case "flow_published": {
      const id = text(m.flow_id);
      const f = (id && ctx.flows?.[id]) || null;
      const version = count(m.version);
      if (version !== null) details.push(`Versión ${version}`);
      return { title: `Publicó ${f ? `el flujo ${quote(f)}` : "un flujo"}`, details };
    }
    case "flow_deleted": {
      const id = text(m.flow_id);
      const f = (id && ctx.flows?.[id]) || null;
      return { title: `Eliminó ${f ? `el flujo ${quote(f)}` : "un flujo"}`, details };
    }

    // ── Exportaciones ──
    case "data_exported": {
      const file = text(m.file) ?? text(row.to_value);
      const rows = count(m.rows);
      const what = file ? `el archivo ${quote(file)}` : "un archivo de datos";
      return { title: `Descargó ${what}${rows !== null ? ` (${plural(rows, "fila", "filas")})` : ""}`, details };
    }
    case "source_downloaded":
      return { title: "Descargó el código de la app", details };
  }

  // Etapas, categorías y motivos comparten las mismas acciones (`stage_created`, ...).
  const item = /^(stage|category|reason)_(created|updated|archived|restored|deleted)$/.exec(action);
  if (item) {
    const noun = ITEM_NOUN[item[1]];
    const verb = VERB[item[2]];
    if (item[2] === "updated") details.push(...changeLines(m.changes));
    if (item[2] === "archived" || item[2] === "deleted") details.push(...usageDetails(m));
    return { title: itemTitle(verb, noun.one, noun.article, name, caseType), details };
  }
  const reordered = /^(stage|category|reason)_reordered$/.exec(action);
  if (reordered) {
    return { title: `Cambió el orden de ${ITEM_NOUN[reordered[1]].list}${inType(caseType)}`, details };
  }
  return null;
}

function inType(caseType: string | null): string {
  return caseType ? ` del tipo de gestión ${quote(caseType)}` : "";
}

/** Cuántas gestiones se movieron o reglas se borraron al archivar o eliminar. */
function usageDetails(m: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const moved = count(m.moved_cases);
  if (moved && moved > 0) lines.push(`${plural(moved, "gestión pasó", "gestiones pasaron")} a otra etapa`);
  const rules = count(m.deleted_rules);
  if (rules && rules > 0) lines.push(`${plural(rules, "regla eliminada", "reglas eliminadas")}`);
  const history = count(m.history_cases) ?? count(m.contacts);
  if (history && history > 0) lines.push(`Tenía historial: se archivó en vez de borrarse`);
  return lines;
}

/** Frase de respaldo cuando la acción no está en la lista (nunca JSON crudo). */
function fallbackTitle(entity: string | null): string {
  switch (entity) {
    case "team":
      return "Hizo un cambio en el equipo";
    case "channel":
      return "Hizo un cambio en los canales";
    case "broadcast":
      return "Hizo un cambio en una difusión";
    case "flow":
      return "Hizo un cambio en un flujo";
    case "teams":
      return "Hizo un cambio en los equipos de trabajo";
    case "hours":
      return "Hizo un cambio en el horario o los feriados";
    case "attention":
      return "Hizo un cambio en los ajustes de atención";
    case "saved_reply":
      return "Hizo un cambio en las respuestas guardadas";
    case "dictionary":
      return "Hizo un cambio en el diccionario de la tienda";
    case "sequence":
      return "Hizo un cambio en una secuencia";
    case "export":
    case "source_code":
      return "Descargó datos";
    case "secrets":
      return "Cambió una clave de la app";
    default:
      return "Hizo un cambio de configuración";
  }
}

const CORRECTED_FIELDS = new Set(["nombre", "correo", "teléfono"]);

/** Describe una fila del registro. Nunca lanza. */
export function describeAudit(row: AuditRowInput, ctx: AuditLabelContext = {}): AuditDescription {
  try {
    return describe(row, ctx);
  } catch {
    return { title: "Hizo un cambio", details: [], category: null, known: false };
  }
}

function describe(row: AuditRowInput, ctx: AuditLabelContext): AuditDescription {
  const m = obj(row.meta);
  const contact = text(ctx.contactName);
  const forContact = contact ? `a ${contact}` : "a un cliente";
  const ofContact = contact ? `de ${contact}` : "de un cliente";

  switch (row.type) {
    case "config_changed": {
      const action = text(m.action);
      const entity = text(m.entity);
      const found = action ? describeConfig(action, row, m, ctx) : null;
      if (found && action) {
        return { ...found, category: AUDIT_ACTIONS[action]?.category ?? (entity ? (ENTITY_CATEGORY[entity] ?? "config") : "config"), known: true };
      }
      return {
        title: fallbackTitle(entity),
        details: [],
        category: entity ? (ENTITY_CATEGORY[entity] ?? "config") : "config",
        known: false,
      };
    }
    case "contacts_imported": {
      const file = text(m.file_name);
      const lines: string[] = [];
      const total = count(m.total);
      if (total !== null) lines.push(`${plural(total, "fila", "filas")} en el archivo`);
      const created = count(m.created);
      const updated = count(m.updated);
      const skipped = count(m.skipped);
      const errors = count(m.errors);
      if (created !== null) lines.push(`${plural(created, "contacto nuevo", "contactos nuevos")}`);
      if (updated !== null) lines.push(`${plural(updated, "contacto actualizado", "contactos actualizados")}`);
      if (skipped) lines.push(`${plural(skipped, "omitido", "omitidos")}`);
      if (errors) lines.push(`${plural(errors, "fila con error", "filas con error")}`);
      if (m.consent_declared === true) {
        const consented = count(m.consented);
        lines.push(
          consented !== null
            ? `Se declaró que aceptaron publicidad (${plural(consented, "contacto", "contactos")})`
            : "Se declaró que aceptaron publicidad",
        );
      }
      return { title: `Importó contactos${file ? ` desde ${quote(file)}` : ""}`, details: lines, category: "exports", known: true };
    }
    case "contact_data_corrected": {
      const fields = (Array.isArray(m.fields) ? m.fields : []).filter((f): f is string => typeof f === "string" && CORRECTED_FIELDS.has(f));
      return {
        title: `Corrigió datos personales ${ofContact}`,
        details: fields.length ? [`Dato corregido: ${fields.join(", ")} (los valores no se guardan en el registro)`] : [],
        category: "contacts",
        known: true,
      };
    }
    case "contact_data_exported":
      return { title: `Descargó una copia de los datos ${ofContact}`, details: [], category: "contacts", known: true };
    case "contact_data_erased": {
      // Nunca se nombra al cliente: sus datos personales ya no existen.
      const details: string[] = [];
      const cases = count(m.cases_kept);
      const claims = count(m.claims_kept);
      if (cases) details.push(`${cases === 1 ? "Se conservó" : "Se conservaron"} ${plural(cases, "gestión", "gestiones")} sin datos personales`);
      if (claims) details.push(`${claims === 1 ? "Se conservó" : "Se conservaron"} ${plural(claims, "reclamo", "reclamos")} sin datos personales`);
      return { title: "Eliminó los datos de un cliente", details, category: "contacts", known: true };
    }
    case "contact_data_erase_files_retried": {
      const pending = count(m.pending);
      return {
        title: "Reintentó borrar los archivos de un cliente eliminado",
        details: pending === null ? [] : [pending === 0 ? "Ya no quedan archivos pendientes" : `Quedan ${plural(pending, "archivo", "archivos")} por borrar`],
        category: "contacts",
        known: true,
      };
    }
    case "contact_subscribed":
    case "contact_unsubscribed": {
      const to = text(row.to_value);
      const from = text(row.from_value);
      const details: string[] = [];
      const label = (s: string | null) => (s === "accepted" ? "Aceptó publicidad" : s === "opted_out" ? "De baja de publicidad" : s === "unknown" ? "Sin registrar" : null);
      if (label(from) && label(to)) details.push(`Estado: ${label(from)} → ${label(to)}`);
      details.push("Lo anotó una persona desde la ficha del cliente");
      return {
        title:
          row.type === "contact_unsubscribed"
            ? `Marcó ${forContact} como dado de baja de la publicidad`
            : `Registró que ${contact ?? "un cliente"} aceptó recibir publicidad`,
        details,
        category: "contacts",
        known: true,
      };
    }
    default:
      return { title: "Registró un cambio", details: [], category: null, known: false };
  }
}

// ── Quién lo hizo ──────────────────────────────────────────────────────────

/** «Sistema» si fue automático; el nombre si se conoce; si no, «Persona eliminada». */
export function auditActorLabel(actorId: string | null, names: Record<string, string | undefined>): string {
  if (!actorId) return "Sistema";
  return names[actorId] ?? "Persona eliminada";
}
