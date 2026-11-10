// Vista "Por cliente" de Gestiones: agrupa las gestiones que cumplen la
// pestaña y los filtros por cliente, ordena a los clientes por urgencia y los
// pagina POR CLIENTE (contact_id distintos). Lógica pura, sin base de datos,
// para probarla con vitest. La consulta vive en app/(dashboard)/dashboard/cases/load-cases.ts.
//
// Urgencia (menor = primero), por gestión:
//   nivel 0  reclamo vencido: plazo de la solución pasado o compromiso vencido;
//            dentro del nivel, la que venció hace más tiempo primero.
//   nivel 1  corre contra el plazo de la solución (todavía hay tiempo);
//            la que vence antes, primero. El plazo se calcula en JS con las
//            MISMAS funciones que el chip "Sin solución a tiempo" (solutionState,
//            horas hábiles del equipo y feriados), así que orden y chip coinciden.
//   nivel 2  sin plazo: el criterio de la pestaña, el mismo de la vista "Por
//            gestión" (Abiertas: espera más antigua; Para hoy: próximo contacto
//            más cercano; Programadas: fecha de activación; Cerradas: cierre más reciente).
// La urgencia de un cliente es la de su gestión más urgente entre las que
// cumplen la pestaña y los filtros. Empates: el cliente con la gestión creada
// más recientemente primero y, al final, por id (orden estable entre páginas).

import { solutionState, type SolutionSchedule } from "@/lib/cases/protection";
import type { CaseTab } from "@/components/cases/case-filters";

/** Lo mínimo de una gestión para ordenarla y agruparla. */
export interface UrgencyCase {
  id: string;
  contactId: string;
  status: string;
  openedAt: string | null;
  waitingSince: string | null;
  nextActionAt: string | null;
  scheduledFor: string | null;
  closedAt: string | null;
  createdAt: string | null;
  solutionStatus: string | null;
  solutionNote: string | null;
  solutionClockAt: string | null;
  /** Horas para registrar la solución (del tipo); null = sin plazo. */
  deadlineHours: number | null;
  /** Horario hábil de la gestión (equipo o empresa); null = horas de reloj. */
  schedule: SolutionSchedule | null;
}

export type UrgencyKey = readonly [tier: number, time: number, tie: number];

function ms(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return t;
}

/** Valor ordenable: las fechas ausentes o inválidas van al final. */
function orLast(value: number): number {
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

export function caseUrgencyKey(c: UrgencyCase, tab: CaseTab, now: Date): UrgencyKey {
  // Desempate: la creada más recientemente primero.
  const created = ms(c.createdAt);
  const tie = Number.isNaN(created) ? 0 : -created;
  if (c.status === "open") {
    const state = solutionState(
      {
        status: c.status,
        openedAt: c.openedAt,
        solutionClockAt: c.solutionClockAt,
        solutionStatus: c.solutionStatus,
        solutionNote: c.solutionNote,
        nextActionAt: c.nextActionAt,
        solutionSchedule: c.schedule,
      },
      c.deadlineHours,
      now,
    );
    if (state.kind === "overdue") return [0, ms(state.dueAt), tie];
    if (state.kind === "in_progress" && state.commitmentOverdue) return [0, orLast(ms(state.commitmentAt)), tie];
    if (state.kind === "pending") return [1, ms(state.dueAt), tie];
  }
  switch (tab) {
    case "open":
      return [2, orLast(ms(c.waitingSince)), tie];
    case "today":
      return [2, orLast(ms(c.nextActionAt)), tie];
    case "scheduled":
      return [2, orLast(ms(c.scheduledFor)), tie];
    case "closed": {
      const closed = ms(c.closedAt);
      return [2, Number.isNaN(closed) ? Number.POSITIVE_INFINITY : -closed, tie];
    }
  }
}

export function compareUrgency(a: UrgencyKey, b: UrgencyKey): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export interface ClientBucket {
  contactId: string;
  /** Gestiones que cumplen la pestaña y los filtros, la más urgente primero. */
  caseIds: string[];
  key: UrgencyKey;
}

/** Un cubo por cliente, con sus gestiones que cumplen, ordenados por urgencia. */
export function bucketByClient(cases: readonly UrgencyCase[], tab: CaseTab, now: Date): ClientBucket[] {
  const byContact = new Map<string, { id: string; key: UrgencyKey }[]>();
  for (const c of cases) {
    const entry = { id: c.id, key: caseUrgencyKey(c, tab, now) };
    const list = byContact.get(c.contactId);
    if (list) list.push(entry);
    else byContact.set(c.contactId, [entry]);
  }
  const buckets: ClientBucket[] = [];
  for (const [contactId, list] of byContact) {
    list.sort((a, b) => compareUrgency(a.key, b.key) || (a.id < b.id ? -1 : 1));
    buckets.push({ contactId, caseIds: list.map((x) => x.id), key: list[0].key });
  }
  return buckets.sort((a, b) => compareUrgency(a.key, b.key) || (a.contactId < b.contactId ? -1 : 1));
}

export interface ClientPage {
  buckets: ClientBucket[];
  /** Página efectiva (una fuera de rango vuelve a la primera). */
  page: number;
  totalClients: number;
  totalCases: number;
}

/** Corta la lista de clientes: `pageSize` clientes por página, no gestiones. */
export function paginateClients(buckets: readonly ClientBucket[], page: number, pageSize: number): ClientPage {
  const pages = Math.max(1, Math.ceil(buckets.length / pageSize));
  const effective = page >= 1 && page <= pages ? page : 1;
  const from = (effective - 1) * pageSize;
  return {
    buckets: buckets.slice(from, from + pageSize),
    page: effective,
    totalClients: buckets.length,
    totalCases: buckets.reduce((sum, b) => sum + b.caseIds.length, 0),
  };
}

/** Orden de las gestiones DENTRO de un cliente (las que cumplen y las que no): por urgencia. */
export function sortClientCases<T extends UrgencyCase>(cases: readonly T[], tab: CaseTab, now: Date): T[] {
  return cases
    .map((c) => ({ c, key: caseUrgencyKey(c, tab, now) }))
    .sort((a, b) => compareUrgency(a.key, b.key) || (a.c.id < b.c.id ? -1 : 1))
    .map((x) => x.c);
}
