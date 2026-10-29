// Plantillas de negocio (docs/PLAN-CRM.md 3.2 a 3.4, docs/FASE-1-TECNICO.md 3.6).
//
// Son datos en código. `applyBusinessTemplate` es idempotente: agrega por
// nombre lo que falta (tipos de contacto, tipos de gestión, etapas,
// categorías, motivos y reglas), nunca borra ni reemplaza, y guarda
// `settings.business_template` y `settings.key_date_label` (esta última solo
// si no había una). La migración no carga datos: lo hace el asistente.

import type {
  BusinessTemplate,
  CaseRuleAction,
  CaseRuleTrigger,
  Json,
  OutcomeKind,
  StageKind,
} from "@/lib/types/database";
import { logActivity, type Db as SupabaseDb } from "@/lib/cases/io";
import { mergeWorkspaceSettings } from "@/lib/workspace-settings";

// ── Datos ──────────────────────────────────────────────────────────────────

export interface TemplateContactType {
  name: string;
  color: string;
  isDefault?: boolean;
}

export interface TemplateStage {
  name: string;
  kind: StageKind;
  color?: string;
}

export interface TemplateRule {
  trigger: Exclude<CaseRuleTrigger, "on_stage">;
  action: CaseRuleAction;
  /** Nombre del tipo de contacto (set_contact_type). */
  contactType?: string;
  fromNthWin?: number;
  /** Nombre del tipo de gestión (schedule_case). */
  caseType?: string;
  daysAfter?: number;
  daysBeforeKeyDate?: number;
  /** Etiqueta (ask_key_date). */
  label?: string;
}

export interface TemplateCaseType {
  name: string;
  color: string;
  icon?: string;
  isProactive?: boolean;
  /** Nombres de los tipos de contacto para los que este tipo es el sugerido. */
  suggestedFor?: string[];
  requireCategory?: boolean;
  requireOutcomeReason?: boolean;
  /** En orden: primero las abiertas, luego las de cierre. */
  stages: TemplateStage[];
  categories?: { name: string; isHighPriority?: boolean }[];
  reasons?: { name: string; kind: OutcomeKind }[];
  rules?: TemplateRule[];
}

export interface BusinessTemplateDef {
  key: BusinessTemplate;
  name: string;
  description: string;
  keyDateLabel?: string;
  contactTypes: TemplateContactType[];
  caseTypes: TemplateCaseType[];
}

const lost = (names: string[]) => names.map((name) => ({ name, kind: "lost" as const }));

const VENTA_LOST_REASONS = [
  "Precio",
  "Sin stock",
  "Costo o demora del envío",
  "Solo consultaba",
  "Dejó de responder",
  "Compró en otro lado",
];

/** Una compra ganada: Cliente, desde la segunda Cliente frecuente, y Recompra en 25 días. */
const ECOMMERCE_WIN_RULES: TemplateRule[] = [
  { trigger: "on_won", action: "set_contact_type", contactType: "Cliente" },
  { trigger: "on_won", action: "set_contact_type", contactType: "Cliente frecuente", fromNthWin: 2 },
  { trigger: "on_won", action: "schedule_case", caseType: "Recompra", daysAfter: 25 },
];

const GYM_KEY_DATE_LABEL = "Vencimiento de membresía";

export const BUSINESS_TEMPLATES: Record<BusinessTemplate, BusinessTemplateDef> = {
  ecommerce: {
    key: "ecommerce",
    name: "E-commerce",
    description: "Tienda en línea: ventas, postventa, consultas y recompra.",
    keyDateLabel: "Última compra",
    contactTypes: [
      { name: "Prospecto", color: "#3b82f6", isDefault: true },
      { name: "Cliente", color: "#22c55e" },
      { name: "Cliente frecuente", color: "#a855f7" },
      { name: "Inactivo", color: "#6b7280" },
    ],
    caseTypes: [
      {
        name: "Venta",
        color: "#22c55e",
        icon: "shopping-cart",
        suggestedFor: ["Prospecto"],
        requireOutcomeReason: true,
        stages: [
          { name: "Nuevo interesado", kind: "open" },
          { name: "Asesorando", kind: "open" },
          { name: "Pedido o enlace de pago enviado", kind: "open" },
          { name: "Esperando pago", kind: "open" },
          { name: "Pagado", kind: "won" },
          { name: "No compró", kind: "lost" },
        ],
        reasons: lost(VENTA_LOST_REASONS),
        rules: ECOMMERCE_WIN_RULES,
      },
      {
        name: "Postventa",
        color: "#f59e0b",
        icon: "package",
        stages: [
          { name: "Nueva", kind: "open" },
          { name: "En gestión", kind: "open" },
          { name: "Esperando al cliente", kind: "open" },
          { name: "Esperando almacén o courier", kind: "open" },
          { name: "Resuelta", kind: "resolved" },
          { name: "Sin solución", kind: "lost" },
        ],
        categories: [
          { name: "Estado de pedido" },
          { name: "Cambio o devolución" },
          { name: "Producto dañado" },
          { name: "Comprobante" },
          { name: "Reclamo", isHighPriority: true },
        ],
      },
      {
        name: "Consulta",
        color: "#0ea5e9",
        icon: "message-circle",
        // "Sin etapas intermedias": una abierta y la de cierre.
        stages: [
          { name: "Abierta", kind: "open" },
          { name: "Resuelta", kind: "resolved" },
        ],
      },
      {
        name: "Recompra",
        color: "#a855f7",
        icon: "repeat",
        isProactive: true,
        requireOutcomeReason: true,
        stages: [
          { name: "Recordatorio enviado", kind: "open" },
          { name: "Interesado", kind: "open" },
          { name: "Compró", kind: "won" },
          { name: "No compró", kind: "lost" },
        ],
        reasons: lost(VENTA_LOST_REASONS),
        // Una Recompra ganada cuenta igual que una Venta.
        rules: ECOMMERCE_WIN_RULES,
      },
    ],
  },

  gym: {
    key: "gym",
    name: "Gimnasio",
    description: "Gimnasio con sedes: venta de membresías, atención al socio y renovaciones.",
    keyDateLabel: GYM_KEY_DATE_LABEL,
    contactTypes: [
      { name: "Prospecto", color: "#3b82f6", isDefault: true },
      { name: "Socio activo", color: "#22c55e" },
      { name: "Socio congelado", color: "#0ea5e9" },
      { name: "Ex socio", color: "#6b7280" },
    ],
    caseTypes: [
      {
        name: "Venta de membresía",
        color: "#22c55e",
        icon: "badge-dollar-sign",
        suggestedFor: ["Prospecto"],
        requireOutcomeReason: true,
        stages: [
          { name: "Nuevo interesado", kind: "open" },
          { name: "Asesorando", kind: "open" },
          { name: "Visita o clase de prueba agendada", kind: "open" },
          { name: "Visitó la sede", kind: "open" },
          { name: "Inscrito", kind: "won" },
          { name: "No se inscribió", kind: "lost" },
        ],
        reasons: lost([
          "Precio",
          "Ubicación u horario",
          "Eligió otro gimnasio",
          "No asistió a la visita",
          "Solo consultaba",
          "Dejó de responder",
        ]),
        rules: [
          { trigger: "on_won", action: "set_contact_type", contactType: "Socio activo" },
          { trigger: "on_won", action: "ask_key_date", label: GYM_KEY_DATE_LABEL },
          { trigger: "on_won", action: "schedule_case", caseType: "Renovación", daysBeforeKeyDate: 7 },
        ],
      },
      {
        name: "Atención al socio",
        color: "#f59e0b",
        icon: "life-buoy",
        stages: [
          { name: "Nueva", kind: "open" },
          { name: "En gestión", kind: "open" },
          { name: "Esperando al socio", kind: "open" },
          { name: "Resuelta", kind: "resolved" },
        ],
        categories: [
          { name: "Congelamiento" },
          { name: "Cambio de plan o sede" },
          { name: "Pagos" },
          { name: "Horarios y clases" },
          { name: "Baja" },
          { name: "Reclamo", isHighPriority: true },
        ],
      },
      {
        name: "Renovación",
        color: "#a855f7",
        icon: "refresh-cw",
        isProactive: true,
        requireOutcomeReason: true,
        stages: [
          { name: "Por vencer", kind: "open" },
          { name: "Contactado", kind: "open" },
          { name: "Renovó", kind: "won" },
          { name: "No renovó", kind: "lost" },
        ],
        reasons: lost(["Precio", "Se muda", "Lesión o salud", "Poco uso", "Eligió otro gimnasio"]),
        rules: [
          // Una ganada actualiza la fecha de vencimiento y programa la siguiente.
          { trigger: "on_won", action: "ask_key_date", label: GYM_KEY_DATE_LABEL },
          { trigger: "on_won", action: "schedule_case", caseType: "Renovación", daysBeforeKeyDate: 7 },
          // Una perdida pasa el contacto a Ex socio.
          { trigger: "on_lost", action: "set_contact_type", contactType: "Ex socio" },
        ],
      },
    ],
  },

  general: {
    key: "general",
    name: "General",
    description: "Un solo tipo de gestión, Abierta y Resuelta. El CRM se comporta como hasta ahora.",
    contactTypes: [{ name: "Contacto", color: "#6b7280", isDefault: true }],
    caseTypes: [
      {
        name: "General",
        color: "#6b7280",
        icon: "message-square",
        suggestedFor: ["Contacto"],
        stages: [
          { name: "Abierta", kind: "open" },
          { name: "Resuelta", kind: "resolved" },
        ],
      },
    ],
  },

  blank: {
    key: "blank",
    name: "En blanco",
    description: "Sin datos precargados, para armar todo desde cero.",
    contactTypes: [],
    caseTypes: [],
  },
};

export const BUSINESS_TEMPLATE_KEYS = Object.keys(BUSINESS_TEMPLATES) as BusinessTemplate[];

export function isBusinessTemplateKey(value: unknown): value is BusinessTemplate {
  return typeof value === "string" && (BUSINESS_TEMPLATE_KEYS as string[]).includes(value);
}

// ── Aplicación ─────────────────────────────────────────────────────────────

/** Comparación por nombre: sin mayúsculas, tildes ni espacios de más. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export interface ExistingCaseType {
  id: string;
  name: string;
  stages: { name: string; position: number }[];
  categories: { name: string; position: number }[];
  reasons: { name: string; kind: OutcomeKind; position: number }[];
  rules: { trigger: CaseRuleTrigger; trigger_stage_id: string | null; action: CaseRuleAction; params: Json; position: number }[];
}

export interface ExistingConfig {
  contactTypes: { id: string; name: string; isDefault: boolean; archived: boolean; position: number }[];
  caseTypes: (ExistingCaseType & { position: number })[];
  settings: Record<string, unknown>;
}

export interface NewContactType {
  workspace_id: string;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
}

export interface NewCaseType {
  workspace_id: string;
  name: string;
  color: string;
  icon: string | null;
  position: number;
  is_proactive: boolean;
  suggested_for_contact_type_ids: string[];
  require_category: boolean;
  require_outcome_reason: boolean;
}

export interface NewStage { case_type_id: string; name: string; kind: StageKind; color: string | null; position: number }
export interface NewCategory { case_type_id: string; name: string; position: number; is_high_priority: boolean }
export interface NewReason { case_type_id: string; name: string; kind: OutcomeKind; position: number }
export interface NewRule {
  case_type_id: string;
  position: number;
  trigger: CaseRuleTrigger;
  action: CaseRuleAction;
  condition: Json;
  params: Json;
}

/** Acceso a datos que usa applyBusinessTemplate (la real usa Supabase; las pruebas, memoria). */
export interface TemplateStore {
  load(workspaceId: string): Promise<ExistingConfig>;
  insertContactTypes(rows: NewContactType[]): Promise<{ id: string; name: string }[]>;
  insertCaseTypes(rows: NewCaseType[]): Promise<{ id: string; name: string }[]>;
  insertStages(rows: NewStage[]): Promise<void>;
  insertCategories(rows: NewCategory[]): Promise<void>;
  insertReasons(rows: NewReason[]): Promise<void>;
  insertRules(rows: NewRule[]): Promise<void>;
  saveSettings(workspaceId: string, settings: Record<string, unknown>): Promise<void>;
}

export interface TemplateApplyResult {
  template: BusinessTemplate;
  added: {
    contactTypes: number;
    caseTypes: number;
    stages: number;
    categories: number;
    reasons: number;
    rules: number;
  };
}

function nextPosition(items: readonly { position: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.position + 1), 0);
}

function obj(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Identidad de una regla para no duplicarla (los días no cuentan: el administrador pudo cambiarlos). */
function ruleKey(rule: { trigger: CaseRuleTrigger; action: CaseRuleAction; params: Json }): string {
  const p = obj(rule.params);
  const target =
    rule.action === "set_contact_type"
      ? String(p.contact_type_id ?? "")
      : rule.action === "schedule_case"
        ? String(p.case_type_id ?? "")
        : "ask";
  return `${rule.trigger}|${rule.action}|${target}`;
}

/**
 * Agrega a `workspaceId` lo que le falte de la plantilla, por nombre. Nunca
 * borra ni modifica lo existente (salvo sumar hijos a un tipo que ya existe).
 */
export async function applyTemplateWithStore(
  store: TemplateStore,
  workspaceId: string,
  key: BusinessTemplate,
): Promise<TemplateApplyResult> {
  const template = BUSINESS_TEMPLATES[key];
  const existing = await store.load(workspaceId);
  const added = { contactTypes: 0, caseTypes: 0, stages: 0, categories: 0, reasons: 0, rules: 0 };

  // 1. Tipos de contacto.
  const contactTypeIds = new Map(existing.contactTypes.map((t) => [normalizeName(t.name), t.id]));
  const hasDefault = existing.contactTypes.some((t) => t.isDefault && !t.archived);
  let position = nextPosition(existing.contactTypes);
  const newContactTypes: NewContactType[] = [];
  for (const ct of template.contactTypes) {
    if (contactTypeIds.has(normalizeName(ct.name))) continue;
    newContactTypes.push({
      workspace_id: workspaceId,
      name: ct.name,
      color: ct.color,
      position: position++,
      is_default: !!ct.isDefault && !hasDefault && !newContactTypes.some((n) => n.is_default),
    });
  }
  if (newContactTypes.length > 0) {
    for (const row of await store.insertContactTypes(newContactTypes)) {
      contactTypeIds.set(normalizeName(row.name), row.id);
    }
    added.contactTypes = newContactTypes.length;
  }
  const contactTypeId = (name: string) => contactTypeIds.get(normalizeName(name));

  // 2. Tipos de gestión.
  const caseTypes = new Map(existing.caseTypes.map((t) => [normalizeName(t.name), t as ExistingCaseType]));
  position = nextPosition(existing.caseTypes);
  const newCaseTypes: NewCaseType[] = [];
  for (const ct of template.caseTypes) {
    if (caseTypes.has(normalizeName(ct.name))) continue;
    newCaseTypes.push({
      workspace_id: workspaceId,
      name: ct.name,
      color: ct.color,
      icon: ct.icon ?? null,
      position: position++,
      is_proactive: !!ct.isProactive,
      suggested_for_contact_type_ids: (ct.suggestedFor ?? [])
        .map(contactTypeId)
        .filter((id): id is string => !!id),
      require_category: !!ct.requireCategory,
      require_outcome_reason: !!ct.requireOutcomeReason,
    });
  }
  if (newCaseTypes.length > 0) {
    for (const row of await store.insertCaseTypes(newCaseTypes)) {
      caseTypes.set(normalizeName(row.name), { id: row.id, name: row.name, stages: [], categories: [], reasons: [], rules: [] });
    }
    added.caseTypes = newCaseTypes.length;
  }

  // 3. Etapas, categorías, motivos y reglas de cada tipo.
  const stages: NewStage[] = [];
  const categories: NewCategory[] = [];
  const reasons: NewReason[] = [];
  const rules: NewRule[] = [];
  for (const ct of template.caseTypes) {
    const target = caseTypes.get(normalizeName(ct.name));
    if (!target) continue;

    const stageNames = new Set(target.stages.map((s) => normalizeName(s.name)));
    let pos = nextPosition(target.stages);
    for (const s of ct.stages) {
      if (stageNames.has(normalizeName(s.name))) continue;
      stageNames.add(normalizeName(s.name));
      stages.push({ case_type_id: target.id, name: s.name, kind: s.kind, color: s.color ?? null, position: pos++ });
    }

    const categoryNames = new Set(target.categories.map((c) => normalizeName(c.name)));
    pos = nextPosition(target.categories);
    for (const c of ct.categories ?? []) {
      if (categoryNames.has(normalizeName(c.name))) continue;
      categoryNames.add(normalizeName(c.name));
      categories.push({ case_type_id: target.id, name: c.name, position: pos++, is_high_priority: !!c.isHighPriority });
    }

    // Un motivo se identifica por nombre y clase ("Precio" puede ser de perdida y de otra clase).
    const reasonKeys = new Set(target.reasons.map((r) => `${r.kind}|${normalizeName(r.name)}`));
    pos = nextPosition(target.reasons);
    for (const r of ct.reasons ?? []) {
      const k = `${r.kind}|${normalizeName(r.name)}`;
      if (reasonKeys.has(k)) continue;
      reasonKeys.add(k);
      reasons.push({ case_type_id: target.id, name: r.name, kind: r.kind, position: pos++ });
    }

    const ruleKeys = new Set(target.rules.map(ruleKey));
    pos = nextPosition(target.rules);
    for (const r of ct.rules ?? []) {
      let params: Record<string, Json> | null = null;
      if (r.action === "set_contact_type") {
        const id = r.contactType ? contactTypeId(r.contactType) : undefined;
        if (id) params = { contact_type_id: id, ...(r.fromNthWin ? { from_nth_win: r.fromNthWin } : {}) };
      } else if (r.action === "schedule_case") {
        const id = r.caseType ? caseTypes.get(normalizeName(r.caseType))?.id : undefined;
        if (id) {
          params =
            r.daysBeforeKeyDate !== undefined
              ? { case_type_id: id, days_before_key_date: r.daysBeforeKeyDate }
              : { case_type_id: id, days_after: r.daysAfter ?? 0 };
        }
      } else {
        params = { label: r.label ?? template.keyDateLabel ?? "Fecha clave" };
      }
      if (!params) continue;
      const rule: NewRule = {
        case_type_id: target.id,
        position: pos,
        trigger: r.trigger,
        action: r.action,
        condition: {},
        params,
      };
      const k = ruleKey(rule);
      if (ruleKeys.has(k)) continue;
      ruleKeys.add(k);
      rules.push(rule);
      pos++;
    }
  }

  if (stages.length > 0) await store.insertStages(stages);
  if (categories.length > 0) await store.insertCategories(categories);
  if (reasons.length > 0) await store.insertReasons(reasons);
  if (rules.length > 0) await store.insertRules(rules);
  added.stages = stages.length;
  added.categories = categories.length;
  added.reasons = reasons.length;
  added.rules = rules.length;

  // 4. Configuración.
  const settings: Record<string, unknown> = { ...existing.settings, business_template: key };
  const label = existing.settings.key_date_label;
  if (template.keyDateLabel && (typeof label !== "string" || label.trim() === "")) {
    settings.key_date_label = template.keyDateLabel;
  }
  await store.saveSettings(workspaceId, settings);

  return { template: key, added };
}

// ── Supabase ───────────────────────────────────────────────────────────────

function throwOn(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Store real con el cliente de servicio. */
export function supabaseTemplateStore(db: SupabaseDb): TemplateStore {
  return {
    async load(workspaceId) {
      const [{ data: ws, error: wsError }, { data: cts, error: ctError }, { data: types, error: tError }] =
        await Promise.all([
          db.from("workspaces").select("settings").eq("id", workspaceId).single(),
          db.from("contact_types").select("id, name, is_default, archived_at, position").eq("workspace_id", workspaceId),
          db.from("case_types").select("id, name, position").eq("workspace_id", workspaceId),
        ]);
      throwOn(wsError, "workspace");
      throwOn(ctError, "contact_types");
      throwOn(tError, "case_types");
      const typeIds = (types ?? []).map((t) => t.id);
      const [stages, categories, reasons, rules] = typeIds.length
        ? await Promise.all([
            db.from("case_stages").select("case_type_id, name, position").in("case_type_id", typeIds),
            db.from("case_categories").select("case_type_id, name, position").in("case_type_id", typeIds),
            db.from("case_outcome_reasons").select("case_type_id, name, kind, position").in("case_type_id", typeIds),
            db
              .from("case_rules")
              .select("case_type_id, trigger, trigger_stage_id, action, params, position")
              .in("case_type_id", typeIds),
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      throwOn(stages.error, "case_stages");
      throwOn(categories.error, "case_categories");
      throwOn(reasons.error, "case_outcome_reasons");
      throwOn(rules.error, "case_rules");

      const settings = ws?.settings;
      return {
        settings:
          settings && typeof settings === "object" && !Array.isArray(settings)
            ? (settings as Record<string, unknown>)
            : {},
        contactTypes: (cts ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          isDefault: t.is_default,
          archived: t.archived_at !== null,
          position: t.position,
        })),
        caseTypes: (types ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          position: t.position,
          stages: (stages.data ?? []).filter((s) => s.case_type_id === t.id),
          categories: (categories.data ?? []).filter((c) => c.case_type_id === t.id),
          reasons: (reasons.data ?? []).filter((r) => r.case_type_id === t.id),
          rules: (rules.data ?? []).filter((r) => r.case_type_id === t.id),
        })),
      };
    },
    async insertContactTypes(rows) {
      const { data, error } = await db.from("contact_types").insert(rows).select("id, name");
      throwOn(error, "insert contact_types");
      return data ?? [];
    },
    async insertCaseTypes(rows) {
      const { data, error } = await db.from("case_types").insert(rows).select("id, name");
      throwOn(error, "insert case_types");
      return data ?? [];
    },
    async insertStages(rows) {
      throwOn((await db.from("case_stages").insert(rows)).error, "insert case_stages");
    },
    async insertCategories(rows) {
      throwOn((await db.from("case_categories").insert(rows)).error, "insert case_categories");
    },
    async insertReasons(rows) {
      throwOn((await db.from("case_outcome_reasons").insert(rows)).error, "insert case_outcome_reasons");
    },
    async insertRules(rows) {
      throwOn((await db.from("case_rules").insert(rows)).error, "insert case_rules");
    },
    async saveSettings(workspaceId, settings) {
      // Se compara con lo que hay AHORA en la base (no con lo leído al empezar): solo se envían las claves
      // que la plantilla cambia, así no se pisan ajustes guardados mientras tanto.
      const { data: fresh } = await db.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
      const current: Record<string, unknown> =
        fresh?.settings && typeof fresh.settings === "object" && !Array.isArray(fresh.settings)
          ? (fresh.settings as Record<string, unknown>)
          : {};
      const next = { ...current };
      for (const key of ["business_template", "key_date_label"]) {
        if (key in settings) next[key] = settings[key];
      }
      const message = await mergeWorkspaceSettings(db, workspaceId, current, next);
      if (message) throw new Error(`save settings: ${message}`);
    },
  };
}

/**
 * Aplica la plantilla con el cliente de servicio y lo registra en `activity`
 * (`config_changed`). Quien llama valida que sea administrador.
 */
export async function applyBusinessTemplate(
  workspaceId: string,
  key: BusinessTemplate,
  opts: { db?: SupabaseDb; actorId?: string | null } = {},
): Promise<TemplateApplyResult> {
  const db = opts.db ?? (await (await import("@/lib/supabase/server")).createServiceClient());
  const result = await applyTemplateWithStore(supabaseTemplateStore(db), workspaceId, key);
  await logActivity(db, {
    workspace_id: workspaceId,
    type: "config_changed",
    actor_id: opts.actorId ?? null,
    to_value: key,
    meta: { action: "apply_business_template", added: result.added },
  });
  return result;
}
