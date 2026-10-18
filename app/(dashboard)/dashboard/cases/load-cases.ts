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
}

export interface CaseListResult {
  rows: CaseListRow[];
  total: number;
  page: number;
}

const COLUMNS =
  "id, contact_id, case_type_id, stage_id, status, origin, assignee_id, team_id, opened_at, scheduled_for, next_action_at, next_action_note, waiting_since, closed_at, created_at, contacts!inner(id, display_name)";

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

async function run(
  db: Db,
  workspaceId: string,
  userId: string,
  canSeeOthers: boolean,
  params: CaseListParams,
  page: number,
  now: Date,
) {
  let query = db
    .from("cases")
    .select(COLUMNS, { count: "exact" })
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
    };
  });
  return { rows, total: res.count ?? rows.length, page };
}
