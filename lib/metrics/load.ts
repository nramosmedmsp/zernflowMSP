// Carga de datos de las métricas con el cliente de Supabase de la persona
// (RLS): un asesor ve lo suyo, el supervisor su equipo y el administrador todo.
// Nunca usa la clave de servicio.

import { addDays } from "@/lib/cases/dates";
import { buildHoursInfo, scheduleForTeam } from "@/lib/cases/hours";
import type { Db } from "@/lib/cases/io";
import type { Json } from "@/lib/types/database";
import { periodRange } from "./period";
import { staleStageDaysFromSettings } from "./overdue";
import type {
  MetricActivity,
  MetricCase,
  MetricCaseType,
  MetricFilters,
  MetricInboundEvent,
  MetricMember,
  MetricReason,
  MetricSchedule,
  MetricStage,
  MetricTeam,
  MetricsInput,
} from "./types";

/** Tope de gestiones leídas; si se supera, la pantalla avisa. */
export const MAX_CASES = 5000;
const MAX_INBOUND_EVENTS = 20_000;
const PAGE = 1000;
const CHUNK = 150;

export interface ContactTypeOption {
  id: string;
  name: string;
}

export interface LoadedMetrics {
  input: MetricsInput;
  contactTypes: ContactTypeOption[];
  channels: string[];
  truncatedCases: boolean;
  truncatedInbound: boolean;
}

const CASE_COLUMNS =
  "id, contact_id, case_type_id, stage_id, status, origin, team_id, assignee_id, outcome_reason_id, opened_at, first_response_at, waiting_since, closed_at, next_action_at, created_at, contacts(display_name, contact_type_id)";

type CaseQueryRow = Omit<MetricCase, "contact_name" | "contact_type_id"> & {
  contacts: { display_name: string | null; contact_type_id: string | null } | { display_name: string | null; contact_type_id: string | null }[] | null;
};

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function toCase(row: CaseQueryRow): MetricCase {
  const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
  const { contacts: _contacts, ...rest } = row;
  void _contacts;
  return { ...rest, contact_name: contact?.display_name ?? null, contact_type_id: contact?.contact_type_id ?? null };
}

export async function loadMetrics(
  db: Db,
  params: {
    workspaceId: string;
    workspaceSettings: unknown;
    filters: MetricFilters;
    /** Administrador o supervisor: ve los mensajes entrantes de todo el espacio. */
    canSeeOthers: boolean;
    /** Puede venir como promesa: se espera al final, para no frenar las consultas. */
    members: MetricMember[] | Promise<MetricMember[]>;
    now: Date;
  },
): Promise<LoadedMetrics> {
  const { workspaceId, filters, now } = params;
  const range = periodRange(filters, now);

  // Gestiones del periodo (abiertas, cerradas o con primera respuesta en él) y todas las abiertas.
  const dbFilters = <T extends { eq: (c: string, v: string) => T }>(q: T): T => {
    let r = q;
    if (filters.caseTypeId) r = r.eq("case_type_id", filters.caseTypeId);
    if (filters.teamId) r = r.eq("team_id", filters.teamId);
    if (filters.assigneeId) r = r.eq("assignee_id", filters.assigneeId);
    if (filters.origin) r = r.eq("origin", filters.origin);
    return r;
  };
  const s = range.startIso;
  const e = range.endIso;
  const periodOr = `and(opened_at.gte.${s},opened_at.lt.${e}),and(closed_at.gte.${s},closed_at.lt.${e}),and(first_response_at.gte.${s},first_response_at.lt.${e})`;

  // Mensajes entrantes: solo para administradores y supervisores (el evento no
  // guarda a quién se asignó, así que no se puede recortar por asesor). No
  // depende de las gestiones: corre en paralelo con todo lo demás. La primera
  // página trae el total y el resto de páginas se piden a la vez.
  const loadInbound = async () => {
    const inbound: MetricInboundEvent[] = [];
    let truncatedInbound = false;
    if (!params.canSeeOthers) return { inbound, truncatedInbound };
    const page = (from: number, withCount: boolean) =>
      db
        .from("analytics_events")
        .select("created_at, metadata", withCount ? { count: "exact" } : undefined)
        .eq("workspace_id", workspaceId)
        .eq("event_type", "message_received")
        .gte("created_at", s)
        .lt("created_at", e)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
    const first = await page(0, true);
    const pages = [first.data ?? []];
    const total = Math.min(first.count ?? pages[0].length, MAX_INBOUND_EVENTS);
    if ((first.count ?? 0) > MAX_INBOUND_EVENTS) truncatedInbound = true;
    const rest: number[] = [];
    for (let from = PAGE; from < total; from += PAGE) rest.push(from);
    const others = await Promise.all(rest.map((from) => page(from, false)));
    for (const r of others) pages.push(r.data ?? []);
    for (const rows of pages) {
      for (const row of rows) {
        const md = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
        const platform = (md as Record<string, Json | undefined>).platform;
        inbound.push({ created_at: row.created_at, platform: typeof platform === "string" ? platform : null });
      }
    }
    return { inbound, truncatedInbound };
  };

  // Todo lo que depende solo del espacio, en una sola ronda. Etapas y motivos
  // se piden con join al tipo para no esperar a la lista de tipos.
  const [typesRes, teamsRes, contactTypesRes, holidaysRes, stagesRes, reasonsRes, periodRes, openRes, inboundResult] =
    await Promise.all([
      db
        .from("case_types")
        .select("id, name, is_proactive, sla_first_response_minutes, sla_resolution_hours")
        .eq("workspace_id", workspaceId),
      db.from("teams").select("id, name, business_hours").eq("workspace_id", workspaceId),
      db.from("contact_types").select("id, name").eq("workspace_id", workspaceId).order("position", { ascending: true }),
      db
        .from("holidays")
        .select("date, team_id")
        .eq("workspace_id", workspaceId)
        .gte("date", addDays(range.startDay, -7)),
      db
        .from("case_stages")
        .select("id, case_type_id, name, position, kind, case_types!inner(workspace_id)")
        .eq("case_types.workspace_id", workspaceId),
      db
        .from("case_outcome_reasons")
        .select("id, case_type_id, name, kind, case_types!inner(workspace_id)")
        .eq("case_types.workspace_id", workspaceId),
      dbFilters(db.from("cases").select(CASE_COLUMNS).eq("workspace_id", workspaceId))
        .or(periodOr)
        .order("created_at", { ascending: false })
        .limit(MAX_CASES + 1),
      dbFilters(db.from("cases").select(CASE_COLUMNS).eq("workspace_id", workspaceId))
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(MAX_CASES + 1),
      loadInbound(),
    ]);

  const caseTypes = (typesRes.data ?? []) as MetricCaseType[];
  const teamRows = teamsRes.data ?? [];
  const members = await params.members;

  const periodRows = (periodRes.data ?? []) as unknown as CaseQueryRow[];
  const openRows = (openRes.data ?? []) as unknown as CaseQueryRow[];
  const truncatedCases = periodRows.length > MAX_CASES || openRows.length > MAX_CASES;
  const byId = new Map<string, MetricCase>();
  for (const row of [...periodRows.slice(0, MAX_CASES), ...openRows.slice(0, MAX_CASES)]) {
    if (!byId.has(row.id)) byId.set(row.id, toCase(row));
  }
  const cases = [...byId.values()];
  const caseIds = cases.map((c) => c.id);
  const contactIds = [...new Set(cases.map((c) => c.contact_id))];

  // Actividad de esas gestiones (con paginación) y plataforma del contacto.
  const activity: MetricActivity[] = [];
  const activityDone = Promise.all(
    chunks(caseIds, CHUNK).map(async (ids) => {
      for (let from = 0; ; from += PAGE) {
        const { data } = await db
          .from("activity")
          .select("case_id, type, actor_id, from_value, to_value, meta, created_at")
          .in("case_id", ids)
          .in("type", ["case_opened", "stage_changed", "first_response", "human_reply"])
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        const rows = (data ?? []) as MetricActivity[];
        activity.push(...rows);
        if (rows.length < PAGE) break;
      }
    }),
  );

  const platformByContact = new Map<string, string>();
  const platformDone = Promise.all(
    chunks(contactIds, 200).map(async (ids) => {
      const { data } = await db
        .from("conversations")
        .select("contact_id, platform, last_message_at")
        .in("contact_id", ids)
        .order("last_message_at", { ascending: false, nullsFirst: false });
      const latest = new Map<string, { platform: string; at: number }>();
      for (const row of data ?? []) {
        const at = row.last_message_at ? Date.parse(row.last_message_at) : 0;
        const prev = latest.get(row.contact_id);
        if (!prev || at > prev.at) latest.set(row.contact_id, { platform: row.platform, at });
      }
      for (const [id, v] of latest) platformByContact.set(id, v.platform);
    }),
  );
  await Promise.all([activityDone, platformDone]);

  // Horarios: el del equipo si tiene uno; si no, el de la empresa.
  const info = buildHoursInfo({
    workspace: { settings: params.workspaceSettings as Json },
    teams: teamRows,
    holidays: holidaysRes.data ?? [],
  });
  const cache = new Map<string, MetricSchedule>();
  const scheduleFor = (teamId: string | null): MetricSchedule => {
    const key = teamId ?? "";
    let hit = cache.get(key);
    if (!hit) {
      hit = scheduleForTeam(info, teamId);
      cache.set(key, hit);
    }
    return hit;
  };

  const teams: MetricTeam[] = teamRows.map((t) => ({ id: t.id, name: t.name }));
  const channels = [...new Set(platformByContact.values())].sort();

  return {
    input: {
      now,
      cases,
      activity,
      stages: (stagesRes.data ?? []) as MetricStage[],
      caseTypes,
      reasons: (reasonsRes.data ?? []) as MetricReason[],
      members,
      teams,
      inbound: inboundResult.inbound,
      platformByContact,
      scheduleFor,
      staleStageDays: staleStageDaysFromSettings(params.workspaceSettings),
    },
    contactTypes: (contactTypesRes.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    channels,
    truncatedCases,
    truncatedInbound: inboundResult.truncatedInbound,
  };
}
