// Línea de tiempo de un contacto (docs/PLAN-CRM.md 7.3): combina `activity`,
// `case_notes` y las gestiones cerradas con su resultado, en orden cronológico
// inverso y con textos en español. Lógica pura, sin E/S, para probarla con
// vitest. Los valores de `activity.from_value` / `to_value` son ids (etapa,
// tipo, equipo, persona), fechas o estados según el tipo (FASE-1-TECNICO 1.3);
// aquí se resuelven a nombres con `TimelineLookups`.

import { formatDate, formatDateTime } from "@/lib/format";

export type TimelineKind =
  | "case"
  | "stage"
  | "assignment"
  | "contact"
  | "note"
  | "schedule"
  | "closed"
  | "system";

export type TimelineTone = "default" | "won" | "lost" | "note" | "muted";

export interface TimelineLookups {
  users: Record<string, string>;
  teams: Record<string, string>;
  caseTypes: Record<string, string>;
  stages: Record<string, string>;
  categories: Record<string, string>;
  outcomeReasons: Record<string, string>;
  contactTypes: Record<string, string>;
}

export interface TimelineActivity {
  id: number | string;
  type: string;
  actor_id: string | null;
  case_id: string | null;
  from_value: string | null;
  to_value: string | null;
  meta: unknown;
  created_at: string;
}

export interface TimelineNote {
  id: string;
  case_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface TimelineCase {
  id: string;
  case_type_id: string | null;
  status: string;
  closed_at: string | null;
  outcome_reason_id: string | null;
  outcome_note: string | null;
  closed_by: string | null;
}

export interface TimelineItem {
  key: string;
  at: string;
  kind: TimelineKind;
  tone: TimelineTone;
  /** Frase principal. */
  title: string;
  /** Detalle (motivo, nota, valor anterior...). */
  detail: string | null;
  /** Quién lo hizo: nombre, "Sistema" si lo hizo el sistema o el bot. */
  actor: string;
  /** Tipo de la gestión a la que pertenece, si aplica. */
  caseLabel: string | null;
}

export const NO_CASE_TYPE = "Sin clasificar";
const UNKNOWN_PERSON = "Alguien";
const SYSTEM_ACTOR = "Sistema";

const OUTCOME_LABELS: Record<string, string> = {
  won: "ganada",
  lost: "perdida",
  resolved: "resuelta",
  cancelled: "cancelada",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "programada",
  open: "abierta",
  won: "ganada",
  lost: "perdida",
  resolved: "resuelta",
  cancelled: "cancelada",
};

const ORIGIN_LABELS: Record<string, string> = {
  inbound: "mensaje entrante",
  proactive: "proactiva",
  manual: "manual",
};

const ASSIGN_VIA_LABELS: Record<string, string> = {
  owner: "responsable del contacto",
  round_robin: "reparto por turnos",
  least_load: "menor carga de trabajo",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function lookup(map: Record<string, string>, id: string | null | undefined, fallback: string): string {
  return (id && map[id]) || fallback;
}

/**
 * Fecha de calendario ("YYYY-MM-DD", como `key_date`) sin desfase de zona:
 * `new Date("2026-11-13")` es medianoche UTC y en Lima sería el día anterior.
 */
export function formatDay(value: string): string {
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-05:00` : value);
}

/** "45 s", "5 min", "2 h 10 min", "3 d". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  if (totalSeconds < 60) return "menos de 1 min";
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} d`;
}

interface Piece {
  kind: TimelineKind;
  tone: TimelineTone;
  title: string;
  detail?: string | null;
}

function joinDetail(parts: (string | null | undefined | false)[]): string | null {
  const text = parts.filter((p): p is string => !!p).join(" · ");
  return text || null;
}

/** Detalle de un cierre: etapa final, motivo, nota y fecha clave. */
function closeDetail(
  lk: TimelineLookups,
  p: { stageId?: string | null; reasonId?: string | null; note?: string | null; keyDate?: string | null },
): string | null {
  return joinDetail([
    p.stageId && lk.stages[p.stageId] ? `Etapa final: ${lk.stages[p.stageId]}` : null,
    p.reasonId && lk.outcomeReasons[p.reasonId] ? `Motivo: ${lk.outcomeReasons[p.reasonId]}` : null,
    p.note ? `Nota: ${p.note}` : null,
    p.keyDate ? `Fecha clave: ${formatDay(p.keyDate)}` : null,
  ]);
}

function activityPiece(
  a: TimelineActivity,
  lk: TimelineLookups,
  cases: Map<string, TimelineCase>,
  noteIds: ReadonlySet<string>,
): Piece | null {
  const meta = asRecord(a.meta);
  const from = a.from_value;
  const to = a.to_value;
  const caseType = (): string => {
    const c = a.case_id ? cases.get(a.case_id) : undefined;
    return lookup(lk.caseTypes, c?.case_type_id, NO_CASE_TYPE);
  };
  const team = (id: string | null) => lookup(lk.teams, id, "Sin equipo");
  const person = (id: string | null) => lookup(lk.users, id, UNKNOWN_PERSON);

  switch (a.type) {
    case "case_opened": {
      const origin = str(meta.origin);
      return {
        kind: "case",
        tone: "default",
        title: `Se abrió la gestión ${lookup(lk.caseTypes, to, NO_CASE_TYPE)}`,
        detail: origin && ORIGIN_LABELS[origin] ? `Origen: ${ORIGIN_LABELS[origin]}` : null,
      };
    }
    case "case_scheduled": {
      const date = to ? formatDate(to) : "una fecha por definir";
      if (meta.rescheduled === true) {
        return {
          kind: "schedule",
          tone: "default",
          title: `Se reprogramó la gestión ${caseType()} para el ${date}`,
          detail: from ? `Antes: ${formatDate(from)}` : null,
        };
      }
      return { kind: "schedule", tone: "default", title: `Se programó la gestión ${caseType()} para el ${date}` };
    }
    case "case_activated":
      return { kind: "schedule", tone: "default", title: `Se activó la gestión programada ${caseType()}` };
    case "case_classified": {
      if (meta.field === "category") {
        return {
          kind: "case",
          tone: "default",
          title: `Categoría: ${lookup(lk.categories, from, "Sin categoría")} → ${lookup(lk.categories, to, "Sin categoría")}`,
        };
      }
      return {
        kind: "case",
        tone: "default",
        title: `Gestión clasificada: ${lookup(lk.caseTypes, from, NO_CASE_TYPE)} → ${lookup(lk.caseTypes, to, NO_CASE_TYPE)}`,
      };
    }
    case "stage_changed":
      return {
        kind: "stage",
        tone: "default",
        title: `Etapa: ${lookup(lk.stages, from, "Sin etapa")} → ${lookup(lk.stages, to, "Sin etapa")}`,
      };
    case "assigned": {
      const via = str(meta.via);
      const automatic = via === "owner" || via === "round_robin" || via === "least_load";
      return {
        kind: "assignment",
        tone: "default",
        title: automatic
          ? `Se asignó automáticamente a ${person(to)}`
          : via === "transfer"
            ? `Se asignó a ${person(to)} al transferirla`
            : `Se asignó a ${person(to)}`,
        detail: joinDetail([
          automatic && via ? `Reparto: ${ASSIGN_VIA_LABELS[via]}` : null,
          from ? `Antes: ${person(from)}` : null,
        ]),
      };
    }
    case "unassigned": {
      const reason = str(meta.reason);
      return {
        kind: "assignment",
        tone: "default",
        title:
          reason === "rerouted"
            ? "Quedó sin responsable al cambiar su destino"
            : reason === "transferred"
              ? "Quedó sin responsable al transferirla"
              : "Se devolvió a la cola, sin responsable",
        detail: from ? `Antes: ${person(from)}` : null,
      };
    }
    case "transferred":
      return {
        kind: "assignment",
        tone: "default",
        title: to ? `Se transfirió al equipo ${team(to)}` : "Se transfirió sin equipo",
        detail: from ? `Antes: ${team(from)}` : null,
      };
    case "case_closed": {
      const outcome = (to && OUTCOME_LABELS[to]) || "cerrada";
      return {
        kind: "closed",
        tone: to === "won" ? "won" : to === "lost" ? "lost" : "default",
        title: `Se cerró la gestión como ${outcome}`,
        detail: closeDetail(lk, {
          stageId: str(meta.stage_id),
          reasonId: str(meta.outcome_reason_id),
          note: str(meta.note),
          keyDate: str(meta.key_date),
        }),
      };
    }
    case "case_reopened":
      return {
        kind: "case",
        tone: "default",
        title: "Se reabrió la gestión",
        detail: from && STATUS_LABELS[from] ? `Estaba ${STATUS_LABELS[from]}` : null,
      };
    case "contact_type_changed": {
      const reason = str(meta.reason);
      return {
        kind: "contact",
        tone: "default",
        title: `Tipo de contacto: ${lookup(lk.contactTypes, from, "Sin tipo")} → ${lookup(lk.contactTypes, to, "Sin tipo")}`,
        detail:
          reason === "rule"
            ? "Por una regla de la gestión"
            : reason === "default"
              ? "Tipo por defecto"
              : reason === "manual"
                ? "Cambio manual"
                : null,
      };
    }
    case "owner_changed": {
      const reason = str(meta.reason);
      const title =
        from && to
          ? `Responsable: ${person(from)} → ${person(to)}`
          : to
            ? `Responsable: ${person(to)}`
            : `Se quitó el responsable${from ? ` (era ${person(from)})` : ""}`;
      return {
        kind: "contact",
        tone: "default",
        title,
        detail:
          reason === "first_assignment"
            ? "Primera asignación"
            : reason === "assigned"
              ? "Al asignar una gestión"
              : reason === "manual"
                ? "Cambio manual"
                : null,
      };
    }
    case "team_changed": {
      const reason = str(meta.reason);
      return {
        kind: "contact",
        tone: "default",
        title: `Equipo: ${team(from)} → ${team(to)}`,
        detail:
          reason === "routing"
            ? "Según el reparto"
            : reason === "classified"
              ? "Al clasificar la gestión"
              : reason === "manual"
                ? "Cambio manual"
                : null,
      };
    }
    case "note_added": {
      const noteId = str(meta.note_id);
      // La nota ya aparece con su texto: no se repite el aviso.
      if (noteId && noteIds.has(noteId)) return null;
      return { kind: "note", tone: "note", title: "Se agregó una nota interna" };
    }
    case "first_response": {
      const seconds = typeof meta.seconds === "number" ? meta.seconds : null;
      return {
        kind: "case",
        tone: "default",
        title: seconds !== null ? `Primera respuesta en ${formatDuration(seconds)}` : "Primera respuesta al cliente",
      };
    }
    case "next_action_set": {
      const note = str(meta.note);
      return {
        kind: "schedule",
        tone: "default",
        title: to ? `Próximo contacto: ${formatDateTime(to)}` : "Se quitó el próximo contacto",
        detail: note ? `Nota: ${note}` : null,
      };
    }
    case "config_changed": {
      const action = str(meta.action);
      return {
        kind: "system",
        tone: "muted",
        title:
          action === "apply_business_template"
            ? `Se aplicó la plantilla de negocio${to ? ` ${to}` : ""}`
            : "Se cambió la configuración",
      };
    }
    default:
      return { kind: "system", tone: "muted", title: `Actividad: ${a.type}` };
  }
}

export interface BuildTimelineInput {
  activity: readonly TimelineActivity[];
  notes: readonly TimelineNote[];
  cases: readonly TimelineCase[];
  lookups: TimelineLookups;
}

function time(value: string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Línea de tiempo en orden cronológico inverso (lo más reciente primero). */
export function buildTimeline(input: BuildTimelineInput): TimelineItem[] {
  const { lookups: lk } = input;
  const casesById = new Map(input.cases.map((c) => [c.id, c]));
  const noteIds = new Set(input.notes.map((n) => n.id));
  const caseLabel = (caseId: string | null): string | null => {
    const c = caseId ? casesById.get(caseId) : undefined;
    return c ? lookup(lk.caseTypes, c.case_type_id, NO_CASE_TYPE) : null;
  };

  const entries: { item: TimelineItem; seq: number }[] = [];
  const closedWithActivity = new Set<string>();

  for (const a of input.activity) {
    const piece = activityPiece(a, lk, casesById, noteIds);
    if (!piece) continue;
    if (a.type === "case_closed" && a.case_id) closedWithActivity.add(a.case_id);
    entries.push({
      seq: typeof a.id === "number" ? a.id : Number(a.id) || 0,
      item: {
        key: `activity-${a.id}`,
        at: a.created_at,
        kind: piece.kind,
        tone: piece.tone,
        title: piece.title,
        detail: piece.detail ?? null,
        actor: a.actor_id ? lookup(lk.users, a.actor_id, UNKNOWN_PERSON) : SYSTEM_ACTOR,
        caseLabel: caseLabel(a.case_id),
      },
    });
  }

  for (const n of input.notes) {
    entries.push({
      seq: -1,
      item: {
        key: `note-${n.id}`,
        at: n.created_at,
        kind: "note",
        tone: "note",
        title: "Nota interna",
        detail: n.body,
        actor: n.author_id ? lookup(lk.users, n.author_id, UNKNOWN_PERSON) : UNKNOWN_PERSON,
        caseLabel: caseLabel(n.case_id),
      },
    });
  }

  // Gestiones cerradas sin su aviso en `activity` (p. ej. anteriores al registro).
  for (const c of input.cases) {
    if (!c.closed_at || closedWithActivity.has(c.id)) continue;
    const outcome = OUTCOME_LABELS[c.status];
    if (!outcome) continue;
    entries.push({
      seq: -1,
      item: {
        key: `case-${c.id}`,
        at: c.closed_at,
        kind: "closed",
        tone: c.status === "won" ? "won" : c.status === "lost" ? "lost" : "default",
        title: `Se cerró la gestión como ${outcome}`,
        detail: closeDetail(lk, { reasonId: c.outcome_reason_id, note: c.outcome_note }),
        actor: c.closed_by ? lookup(lk.users, c.closed_by, UNKNOWN_PERSON) : SYSTEM_ACTOR,
        caseLabel: lookup(lk.caseTypes, c.case_type_id, NO_CASE_TYPE),
      },
    });
  }

  entries.sort((x, y) => time(y.item.at) - time(x.item.at) || y.seq - x.seq);
  return entries.map((e) => e.item);
}
