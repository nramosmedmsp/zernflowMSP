// Consulta de la lista de gestiones. Usa el cliente del usuario: la RLS
// (cases_select = can_see_contact) decide qué gestiones ve cada quien.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CASES_PAGE_SIZE,
  CLOSED_STATUSES,
  NONE_FILTER,
  closedSinceIso,
  ilikePattern,
  resolveAssigneeFilter,
  todayBounds,
  todayOrFilter,
  type CaseListParams,
} from "@/components/cases/case-filters";
import {
  bucketByClient,
  paginateClients,
  sortClientCases,
  type UrgencyCase,
} from "@/lib/cases/client-groups";
import { solutionScheduleFor, type SolutionSchedules } from "@/lib/cases/protection";
import type { CaseOrigin, CaseStatus, Database } from "@/lib/types/database";

export interface CaseListRow {
  id: string;
  contactId: string;
  contactName: string | null;
  caseTypeId: string | null;
  stageId: string | null;
  status: CaseStatus;
  origin: CaseOrigin;
  assigneeId: string | null;
  teamId: string | null;
  openedAt: string | null;
  scheduledFor: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  waitingSince: string | null;
  closedAt: string | null;
  hasConversation: boolean;
  /** Control de reclamos. */
  solutionStatus: string | null;
  solutionNote: string | null;
  solutionClockAt: string | null;
  hasCloseRequest: boolean;
}

export interface CaseListResult {
  rows: CaseListRow[];
  total: number;
  page: number;
}

const COLUMNS =
  "id, contact_id, case_type_id, stage_id, status, origin, assignee_id, team_id, opened_at, scheduled_for, next_action_at, next_action_note, waiting_since, closed_at, created_at, solution_status, solution_note, solution_clock_at, close_request, contacts!inner(id, display_name)";

type Db = SupabaseClient<Database>;

interface RawRow {
  id: string;
  contact_id: string;
  case_type_id: string | null;
  stage_id: string | null;
  status: CaseStatus;
  origin: CaseOrigin;
  assignee_id: string | null;
  team_id: string | null;
  opened_at: string | null;
  scheduled_for: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  waiting_since: string | null;
  closed_at: string | null;
  solution_status: string | null;
  solution_note: string | null;
  solution_clock_at: string | null;
  close_request: unknown;
  contacts: { display_name: string | null } | { display_name: string | null }[] | null;
}

async function activatedTodayIds(db: Db, workspaceId: string, startIso: string): Promise<string[]> {
  const { data } = await db
    .from("activity")
    .select("case_id")
    .eq("workspace_id", workspaceId)
    .eq("type", "case_activated")
    .gte("created_at", startIso)
    .not("case_id", "is", null)
    .limit(500);
  return (data ?? []).map((r) => r.case_id).filter((id): id is string => !!id);
}

/** Filtros de pestaña, tipo, etapa, equipo, responsable y búsqueda: los mismos en las dos vistas. */
async function filteredQuery<C extends string>(
  db: Db,
  workspaceId: string,
  userId: string,
  canSeeOthers: boolean,
  params: CaseListParams,
  now: Date,
  columns: C,
  withCount: boolean,
) {
  let query = db
    .from("cases")
    .select(columns, withCount ? { count: "exact" } : undefined)
    .eq("workspace_id", workspaceId);

  switch (params.tab) {
    case "open":
      query = query.eq("status", "open");
      break;
    case "today": {
      const bounds = todayBounds(now);
      const activated = await activatedTodayIds(db, workspaceId, bounds.startIso);
      query = query.eq("status", "open").or(todayOrFilter(bounds, activated));
      break;
    }
    case "scheduled":
      query = query.eq("status", "scheduled");
      break;
    case "closed": {
      query = query.in("status", [...CLOSED_STATUSES]);
      const since = closedSinceIso(params.period, now);
      if (since) query = query.gte("closed_at", since);
      break;
    }
  }

  if (params.type === NONE_FILTER) query = query.is("case_type_id", null);
  else if (params.type) query = query.eq("case_type_id", params.type);
  if (params.stage) query = query.eq("stage_id", params.stage);
  if (params.team === NONE_FILTER) query = query.is("team_id", null);
  else if (params.team) query = query.eq("team_id", params.team);

  const assignee = resolveAssigneeFilter(params.tab, params.assignee, userId, canSeeOthers);
  if (assignee.kind === "none") query = query.is("assignee_id", null);
  else if (assignee.kind === "user") query = query.eq("assignee_id", assignee.userId);

  if (params.q) query = query.ilike("contacts.display_name", ilikePattern(params.q));
  // En un objeto: devolver el constructor tal cual desde una función async lo ejecutaría (es "thenable").
  return { query };
}

async function run(
  db: Db,
  workspaceId: string,
  userId: string,
  canSeeOthers: boolean,
  params: CaseListParams,
  page: number,
  now: Date,
) {
  let { query } = await filteredQuery(db, workspaceId, userId, canSeeOthers, params, now, COLUMNS, true);

  switch (params.tab) {
    case "open":
      query = query
        .order("waiting_since", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    case "today":
      query = query
        .order("next_action_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      break;
    case "scheduled":
      query = query.order("scheduled_for", { ascending: true, nullsFirst: false });
      break;
    case "closed":
      query = query.order("closed_at", { ascending: false, nullsFirst: false });
      break;
  }

  const from = (page - 1) * CASES_PAGE_SIZE;
  return query.range(from, from + CASES_PAGE_SIZE - 1);
}

export async function loadCases(
  db: Db,
  args: { workspaceId: string; userId: string; canSeeOthers: boolean; params: CaseListParams; now: Date },
): Promise<CaseListResult> {
  const { workspaceId, userId, canSeeOthers, params, now } = args;
  let page = params.page;
  let res = await run(db, workspaceId, userId, canSeeOthers, params, page, now);
  // Página fuera de rango (p. ej. se cerraron gestiones): vuelve a la primera.
  if (res.error && page > 1) {
    page = 1;
    res = await run(db, workspaceId, userId, canSeeOthers, params, page, now);
  }
  if (res.error) {
    console.error("[cases] list", res.error.message);
    return { rows: [], total: 0, page: 1 };
  }
  const raw = (res.data ?? []) as unknown as RawRow[];

  const contactIds = [...new Set(raw.map((r) => r.contact_id))];
  const { data: conversations } = contactIds.length
    ? await db.from("conversations").select("contact_id").in("contact_id", contactIds)
    : { data: [] as { contact_id: string }[] };
  const withConversation = new Set((conversations ?? []).map((c) => c.contact_id));

  const rows: CaseListRow[] = raw.map((r) => {
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return {
      id: r.id,
      contactId: r.contact_id,
      contactName: contact?.display_name ?? null,
      caseTypeId: r.case_type_id,
      stageId: r.stage_id,
      status: r.status,
      origin: r.origin,
      assigneeId: r.assignee_id,
      teamId: r.team_id,
      openedAt: r.opened_at,
      scheduledFor: r.scheduled_for,
      nextActionAt: r.next_action_at,
      nextActionNote: r.next_action_note,
      waitingSince: r.waiting_since,
      closedAt: r.closed_at,
      hasConversation: withConversation.has(r.contact_id),
      solutionStatus: r.solution_status,
      solutionNote: r.solution_note,
      solutionClockAt: r.solution_clock_at,
      hasCloseRequest: r.close_request !== null && r.close_request !== undefined,
    };
  });
  return { rows, total: res.count ?? rows.length, page };
}

// ── Vista "Por cliente" ────────────────────────────────────────────────────
//
// Sin migración: en vez de una vista/RPC, se leen en tandas de 1000 SOLO las
// columnas livianas de las gestiones que cumplen la pestaña y los filtros (con
// los mismos filtros y el mismo cliente de supabase, así que la RLS decide qué
// ve cada quien), se agrupan por cliente y se ordenan en JS por urgencia
// (lib/cases/client-groups.ts). Solo para los clientes de la página se leen las
// gestiones completas, el nombre, el canal y el último mensaje.

export interface ClientCaseRow extends CaseListRow {
  /** Cumple la pestaña y los filtros actuales (se resalta); las demás son contexto. */
  matches: boolean;
}

export interface ClientGroup {
  contactId: string;
  contactName: string | null;
  contactTypeId: string | null;
  platform: Database["public"]["Tables"]["conversations"]["Row"]["platform"] | null;
  lastMessageAt: string | null;
  hasConversation: boolean;
  /** La más urgente primero. */
  cases: ClientCaseRow[];
}

export interface ClientListResult {
  groups: ClientGroup[];
  /** Clientes con al menos una gestión que cumple. */
  totalClients: number;
  /** Gestiones que cumplen (las mismas que cuenta "Por gestión" con los mismos filtros). */
  totalCases: number;
  page: number;
  /** Se llegó al tope de lectura: faltan las gestiones menos urgentes (solo clientes muy grandes). */
  truncated: boolean;
}

const LIGHT_COLUMNS =
  "id, contact_id, case_type_id, team_id, status, opened_at, waiting_since, next_action_at, scheduled_for, closed_at, created_at, solution_status, solution_note, solution_clock_at, contacts!inner(id)";
const FULL_COLUMNS =
  "id, contact_id, case_type_id, stage_id, status, origin, assignee_id, team_id, opened_at, scheduled_for, next_action_at, next_action_note, waiting_since, closed_at, created_at, solution_status, solution_note, solution_clock_at, close_request";

const READ_CHUNK = 1000;
/** Tope de gestiones leídas para agrupar (10 000): una lista más larga se recorta por las más recientes. */
export const MAX_GROUPED_CASES = 10 * READ_CHUNK;
const ID_CHUNK = 150;

interface LightRow {
  id: string;
  contact_id: string;
  case_type_id: string | null;
  team_id: string | null;
  status: CaseStatus;
  opened_at: string | null;
  waiting_since: string | null;
  next_action_at: string | null;
  scheduled_for: string | null;
  closed_at: string | null;
  created_at: string | null;
  solution_status: string | null;
  solution_note: string | null;
  solution_clock_at: string | null;
}

type FullRow = Omit<RawRow, "contacts"> & { created_at: string | null };

export interface DeadlineInfo {
  caseTypes: { id: string; solutionDeadlineHours: number | null }[];
  solutionSchedules: SolutionSchedules | null | undefined;
}

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function loadCasesByClient(
  db: Db,
  args: {
    workspaceId: string;
    userId: string;
    canSeeOthers: boolean;
    params: CaseListParams;
    now: Date;
  } & DeadlineInfo,
): Promise<ClientListResult> {
  const { workspaceId, userId, canSeeOthers, params, now } = args;
  const deadlineOf = new Map(args.caseTypes.map((t) => [t.id, t.solutionDeadlineHours]));
  const urgencyOf = (r: LightRow): UrgencyCase => ({
    id: r.id,
    contactId: r.contact_id,
    status: r.status,
    openedAt: r.opened_at,
    waitingSince: r.waiting_since,
    nextActionAt: r.next_action_at,
    scheduledFor: r.scheduled_for,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    solutionStatus: r.solution_status,
    solutionNote: r.solution_note,
    solutionClockAt: r.solution_clock_at,
    deadlineHours: (r.case_type_id ? deadlineOf.get(r.case_type_id) : null) ?? null,
    schedule: solutionScheduleFor(args.solutionSchedules, r.team_id),
  });
  const empty: ClientListResult = { groups: [], totalClients: 0, totalCases: 0, page: 1, truncated: false };

  // 1. Las gestiones que cumplen, en tandas.
  const matching: LightRow[] = [];
  let truncated = false;
  for (let from = 0; from < MAX_GROUPED_CASES; from += READ_CHUNK) {
    const { query } = await filteredQuery(db, workspaceId, userId, canSeeOthers, params, now, LIGHT_COLUMNS, false);
    const res = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + READ_CHUNK - 1);
    if (res.error) {
      console.error("[cases] client list", res.error.message);
      return empty;
    }
    const part = (res.data ?? []) as unknown as LightRow[];
    matching.push(...part);
    if (part.length < READ_CHUNK) break;
    if (from + READ_CHUNK >= MAX_GROUPED_CASES) truncated = true;
  }

  // 2. Un cubo por cliente, ordenado por urgencia, y la página pedida.
  const buckets = bucketByClient(matching.map(urgencyOf), params.tab, now);
  const paged = paginateClients(buckets, params.page, CASES_PAGE_SIZE);
  if (paged.buckets.length === 0) return { ...empty, truncated };
  const contactIds = paged.buckets.map((b) => b.contactId);
  const matchingIds = new Set(paged.buckets.flatMap((b) => b.caseIds));

  // 3. Gestiones completas de los clientes de la página: en Cerradas, las cerradas que
  // cumplen; en las demás pestañas, TODAS sus activas (abiertas y programadas), con las
  // que cumplen resaltadas.
  const full: FullRow[] = [];
  const closedTab = params.tab === "closed";
  for (const ids of chunk(closedTab ? [...matchingIds] : contactIds, ID_CHUNK)) {
    let q = db.from("cases").select(FULL_COLUMNS).eq("workspace_id", workspaceId);
    q = closedTab ? q.in("id", ids) : q.in("contact_id", ids).in("status", ["open", "scheduled"]);
    const res = await q;
    if (res.error) {
      console.error("[cases] client list detail", res.error.message);
      return empty;
    }
    full.push(...((res.data ?? []) as unknown as FullRow[]));
  }

  // 4. Nombre, tipo de contacto, canal y último mensaje.
  const [contactsRes, convRes] = await Promise.all([
    db.from("contacts").select("id, display_name, contact_type_id").in("id", contactIds),
    db
      .from("conversations")
      .select("contact_id, platform, last_message_at")
      .in("contact_id", contactIds)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
  ]);
  const contactById = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
  const convByContact = new Map<string, { platform: ClientGroup["platform"]; last_message_at: string | null }>();
  for (const c of convRes.data ?? []) if (!convByContact.has(c.contact_id)) convByContact.set(c.contact_id, c);

  const byContact = new Map<string, FullRow[]>();
  for (const r of full) {
    const list = byContact.get(r.contact_id);
    if (list) list.push(r);
    else byContact.set(r.contact_id, [r]);
  }

  const groups: ClientGroup[] = paged.buckets.map((b) => {
    const contact = contactById.get(b.contactId);
    const conv = convByContact.get(b.contactId);
    const toRow = (r: FullRow): ClientCaseRow => ({
      id: r.id,
      contactId: r.contact_id,
      contactName: contact?.display_name ?? null,
      caseTypeId: r.case_type_id,
      stageId: r.stage_id,
      status: r.status,
      origin: r.origin,
      assigneeId: r.assignee_id,
      teamId: r.team_id,
      openedAt: r.opened_at,
      scheduledFor: r.scheduled_for,
      nextActionAt: r.next_action_at,
      nextActionNote: r.next_action_note,
      waitingSince: r.waiting_since,
      closedAt: r.closed_at,
      hasConversation: !!conv,
      solutionStatus: r.solution_status,
      solutionNote: r.solution_note,
      solutionClockAt: r.solution_clock_at,
      hasCloseRequest: r.close_request !== null && r.close_request !== undefined,
      matches: matchingIds.has(r.id),
    });
    const sorted = sortClientCases(
      (byContact.get(b.contactId) ?? []).map((raw) => ({ ...urgencyOf(raw), raw })),
      params.tab,
      now,
    ).map((x) => toRow(x.raw));
    return {
      contactId: b.contactId,
      contactName: contact?.display_name ?? null,
      contactTypeId: contact?.contact_type_id ?? null,
      platform: conv?.platform ?? null,
      lastMessageAt: conv?.last_message_at ?? null,
      hasConversation: !!conv,
      cases: sorted,
    };
  });

  return { groups, totalClients: paged.totalClients, totalCases: paged.totalCases, page: paged.page, truncated };
}
