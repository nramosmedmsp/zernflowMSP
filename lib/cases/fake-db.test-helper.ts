// Base en memoria para las pruebas del motor de gestiones: imita lo que el
// motor usa de supabase-js (select/insert/update con filtros, orden, límite,
// count, single/maybeSingle) y las RPC de las migraciones 00020 y 00021. No es
// un PostgREST completo: ignora la lista de columnas y devuelve filas enteras.
// Imita también el trigger de 00021 que mantiene cases.assigned_at.

import { randomUUID } from "node:crypto";
import { pickAssignee } from "./routing";
import type { Db } from "./io";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const DEFAULTS: Record<string, () => Row> = {
  cases: () => ({
    case_type_id: null,
    stage_id: null,
    category_id: null,
    status: "open",
    team_id: null,
    assignee_id: null,
    origin: "inbound",
    scheduled_for: null,
    opened_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    waiting_since: null,
    first_response_at: null,
    next_action_at: null,
    next_action_note: null,
    next_action_notified_at: null,
    closed_at: null,
    closed_by: null,
    outcome_reason_id: null,
    outcome_note: null,
    legal_due_at: null,
    priority: "normal",
    created_by: null,
    off_hours_reply_sent_at: null,
    auto_template_sent_at: null,
    reassigned_count: 0,
    assigned_at: null,
    wait_alerted_at: null,
    no_reply_event_outbound_at: null,
    no_reply_event_minutes: null,
    sla_first_response_breached_at: null,
    sla_resolution_breached_at: null,
    solution_status: null,
    solution_note: null,
    solution_at: null,
    solution_by: null,
    solution_clock_at: null,
    deadline_alerted_at: null,
    commitment_alerted_at: null,
    close_request: null,
  }),
  contacts: () => ({
    display_name: null,
    contact_type_id: null,
    team_id: null,
    owner_id: null,
    key_date: null,
    source: {},
  }),
  contact_types: () => ({ color: null, position: 0, is_default: false, archived_at: null }),
  case_types: () => ({
    color: null,
    icon: null,
    position: 0,
    is_proactive: false,
    suggested_for_contact_type_ids: [],
    routing: "contact_owner",
    fixed_team_id: null,
    sla_first_response_minutes: null,
    sla_resolution_hours: null,
    require_category: false,
    require_outcome_reason: false,
    auto_template: null,
    protected: false,
    solution_deadline_hours: null,
    reopen_window_days: null,
    archived_at: null,
  }),
  case_stages: () => ({ color: null, position: 0, kind: "open", archived_at: null }),
  case_categories: () => ({ position: 0, is_high_priority: false, archived_at: null }),
  case_outcome_reasons: () => ({ position: 0, archived_at: null }),
  case_rules: () => ({ position: 0, enabled: true, trigger_stage_id: null, condition: {}, params: {} }),
  teams: () => ({ is_default: false, assignment_mode: "round_robin", business_hours: null, archived_at: null }),
  holidays: () => ({ team_id: null }),
  channels: () => ({ is_active: true }),
  triggers: () => ({ channel_id: null, config: {}, priority: 0, is_active: true }),
  flows: () => ({ status: "draft" }),
  team_members: () => ({ role: "agent", case_type_ids: null }),
  workspace_members: () => ({ role: "member", availability: "available", last_assigned_at: null }),
  workspaces: () => ({ settings: {} }),
  conversations: () => ({
    is_automation_paused: false,
    unread_count: 0,
    complaint_flagged_at: null,
    complaint_excerpt: null,
    complaint_alerted_at: null,
    complaint_dismissed_at: null,
  }),
  flow_sessions: () => ({ waiting_for_input: false, waiting_until: null, current_node_id: null, human_takeover_at: null, variables: {} }),
  case_notes: () => ({ mentions: [], conversation_id: null }),
  notifications: () => ({ body: null, link: null, read_at: null }),
  activity: () => ({ contact_id: null, case_id: null, conversation_id: null, actor_id: null, from_value: null, to_value: null, meta: {} }),
};

const NO_ID = new Set(["team_members", "workspace_members", "activity"]);

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
  private conflict: string[] | null = null;
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private limitN: number | null = null;
  private returning = false;
  private head = false;
  private count = false;
  private one: "single" | "maybe" | null = null;
  private payload: Row[] | Row | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === null) this.op = "select";
    else this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count) this.count = true;
    return this;
  }
  insert(rows: Row[] | Row) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  /** Inserta, o actualiza la fila que coincide en `onConflict` (sin él, en todas las columnas enviadas). */
  upsert(rows: Row[] | Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = rows;
    this.conflict = opts?.onConflict ? opts.onConflict.split(",").map((c) => c.trim()) : null;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    // "flows.status": columna de la fila relacionada (la relación "flows" sale de la columna flow_id).
    if (col.includes(".")) {
      const [rel, field] = col.split(".");
      const fk = `${rel.replace(/s$/, "")}_id`;
      this.filters.push((r) => this.db.rows(rel).find((x) => x.id === r[fk])?.[field] === v);
      return this;
    }
    this.filters.push((r) => r[col] === v);
    return this;
  }
  /** Solo condiciones `col.eq.valor` y `col.is.null` separadas por comas. */
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const value = rest.join(".");
      return (r: Row) => {
        if (op === "eq") return String(r[col]) === value;
        if (op === "is" && value === "null") return (r[col] ?? null) === null;
        throw new Error(`or(${op}) no soportado`);
      };
    });
    this.filters.push((r) => parts.some((f) => f(r)));
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  is(col: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) > 0);
    return this;
  }
  lte(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) <= 0);
    return this;
  }
  gte(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) >= 0);
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compare(r[col], v) < 0);
    return this;
  }
  /** Solo `not(col, "is", null)`. */
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`not(${op}) no soportado`);
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  contains(col: string, vs: unknown[]) {
    this.filters.push((r) => Array.isArray(r[col]) && vs.every((v) => (r[col] as unknown[]).includes(v)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const asc = opts?.ascending ?? true;
    this.orders.push({ col, asc, nullsFirst: opts?.nullsFirst ?? !asc });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private finish(rows: Row[]) {
    let result = rows;
    if (this.orders.length) {
      result = [...result].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.col] ?? null;
          const bv = b[o.col] ?? null;
          if (av === bv) continue;
          if (av === null) return o.nullsFirst ? -1 : 1;
          if (bv === null) return o.nullsFirst ? 1 : -1;
          const c = compare(av, bv);
          return o.asc ? c : -c;
        }
        return 0;
      });
    }
    if (this.limitN !== null) result = result.slice(0, this.limitN);
    const data = clone(result);
    if (this.one === "single") {
      if (data.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one row" } };
      return { data: data[0], error: null };
    }
    if (this.one === "maybe") {
      if (data.length > 1) return { data: null, error: { code: "PGRST116", message: "many rows" } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }

  private execute(): { data: unknown; error: unknown; count?: number | null } {
    const fail = this.db.failNext.get(this.table);
    if (fail && fail === this.op) {
      this.db.failNext.delete(this.table);
      return { data: null, error: { message: "fallo simulado" } };
    }
    switch (this.op) {
      case "select": {
        const rows = this.matching();
        if (this.head) return { data: null, error: null, count: rows.length };
        const res = this.finish(rows);
        return this.count ? { ...res, count: rows.length } : res;
      }
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const inserted = list.map((r) => this.db.insertRow(this.table, r));
        if (!this.returning) return { data: null, error: null };
        return this.finish(inserted);
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const keys = this.conflict;
        const out: Row[] = [];
        for (const r of list) {
          const cols = keys ?? Object.keys(r);
          const existing = this.db.rows(this.table).find((x) => cols.every((c) => x[c] === r[c]));
          if (existing) {
            Object.assign(existing, clone(r));
            out.push(existing);
          } else {
            out.push(this.db.insertRow(this.table, r));
          }
        }
        if (!this.returning) return { data: null, error: null };
        return this.finish(out);
      }
      case "update": {
        const rows = this.matching();
        const now = new Date().toISOString();
        for (const r of rows) {
          const before = r.assignee_id;
          Object.assign(r, clone(this.payload as Row), "updated_at" in r ? { updated_at: now } : {});
          // Trigger set_case_assigned_at (00021).
          if (this.table === "cases" && r.assignee_id !== before) {
            r.assigned_at = r.assignee_id ? this.db.now() : null;
          }
        }
        if (!this.returning) return { data: null, error: null };
        return this.finish(rows);
      }
      case "delete": {
        const rows = this.matching();
        this.db.tables[this.table] = this.db.rows(this.table).filter((r) => !rows.includes(r));
        return { data: this.returning ? clone(rows) : null, error: null };
      }
      default:
        return { data: null, error: { message: "sin operación" } };
    }
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  failNext = new Map<string, string>();
  users = new Map<string, { id: string; email: string; user_metadata: Record<string, unknown> }>();

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  insertRow(table: string, row: Row): Row {
    const now = new Date().toISOString();
    const full: Row = {
      ...(DEFAULTS[table]?.() ?? {}),
      ...(NO_ID.has(table) ? {} : { id: randomUUID() }),
      created_at: now,
      updated_at: now,
      ...clone(row),
    };
    if (table === "activity") full.id = this.rows(table).length + 1;
    if (table === "cases" && full.assignee_id && !("assigned_at" in row)) full.assigned_at = this.now();
    this.rows(table).push(full);
    return full;
  }

  seed(table: string, rows: Row[]): Row[] {
    return rows.map((r) => this.insertRow(table, r));
  }

  from(table: string) {
    return new Query(this, table);
  }

  auth = {
    admin: {
      getUserById: async (id: string) => ({ data: { user: this.users.get(id) ?? null }, error: null }),
    },
  };

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "increment_unread") {
      // supabase/migrations/00003_rpc_functions.sql
      const row = this.rows("conversations").find((c) => c.id === args.conv_id);
      if (row) {
        row.unread_count = ((row.unread_count as number) ?? 0) + 1;
        row.last_message_preview = args.preview;
        row.status = "open";
      }
      return { data: null, error: null };
    }
    if (name === "open_inbound_case") {
      const open = this.rows("cases").find((c) => c.contact_id === args.p_contact_id && c.status === "open");
      if (open) return { data: { case_id: open.id, created: false }, error: null };
      const row = this.insertRow("cases", {
        workspace_id: args.p_workspace_id,
        contact_id: args.p_contact_id,
        case_type_id: args.p_case_type_id,
        stage_id: args.p_stage_id,
        status: "open",
        origin: "inbound",
        opened_at: args.p_at,
        last_inbound_at: args.p_at,
        waiting_since: args.p_at,
      });
      return { data: { case_id: row.id, created: true }, error: null };
    }
    if (name === "assign_case_pick") {
      const row = this.rows("cases").find((c) => c.id === args.p_case_id);
      if (!row) return { data: { status: "not_found" }, error: null };
      if (!["open", "scheduled"].includes(row.status as string)) return { data: { status: "not_assignable" }, error: null };
      if (row.assignee_id) return { data: { status: "already_assigned", assignee_id: row.assignee_id }, error: null };
      const members = this.rows("workspace_members").filter(
        (m) =>
          m.workspace_id === row.workspace_id &&
          (args.p_candidates as string[]).includes(m.user_id as string) &&
          m.availability === "available",
      );
      const pick = pickAssignee(
        members.map((m) => ({
          userId: m.user_id as string,
          lastAssignedAt: (m.last_assigned_at as string | null) ?? null,
          openCount: this.rows("cases").filter((c) => c.assignee_id === m.user_id && c.status === "open").length,
        })),
        args.p_mode as "round_robin" | "least_load",
      );
      if (!pick) return { data: { status: "no_candidate" }, error: null };
      row.assignee_id = pick;
      row.assigned_at = this.now();
      const m = members.find((x) => x.user_id === pick)!;
      // Marca estrictamente creciente aunque dos repartos caigan en el mismo milisegundo.
      this.clock += 1;
      m.last_assigned_at = new Date(Date.UTC(2026, 0, 1) + this.clock * 1000).toISOString();
      return { data: { status: "assigned", assignee_id: pick }, error: null };
    }
    if (name === "cases_pending_no_reply") {
      const t = (v: unknown) => (v ? new Date(v as string).getTime() : null);
      const older = t(args.p_older_than)!;
      const rows = this.rows("cases")
        .filter((c) => {
          const out = t(c.last_outbound_at);
          const inn = t(c.last_inbound_at);
          const stamped = t(c.no_reply_event_outbound_at);
          return (
            c.workspace_id === args.p_workspace_id &&
            c.status === "open" &&
            out !== null &&
            out <= older &&
            (inn === null || inn < out) &&
            (stamped !== out || ((c.no_reply_event_minutes as number | null) ?? 0) < (args.p_max_minutes as number)) &&
            (!args.p_after_id || (c.id as string) > (args.p_after_id as string))
          );
        })
        .sort((a, b) => compare(a.id, b.id))
        .slice(0, args.p_limit as number);
      return { data: clone(rows), error: null };
    }
    return { data: null, error: { message: `rpc desconocida ${name}` } };
  }

  private clock = 0;

  /** Reloj del trigger de assigned_at (las pruebas lo fijan). */
  now: () => string = () => new Date().toISOString();

  /** Como cliente tipado del motor. */
  asDb(): Db {
    return this as unknown as Db;
  }
}
