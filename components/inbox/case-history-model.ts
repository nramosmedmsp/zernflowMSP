// Historial de una gestión en español claro (⋯ → Historial). Convierte las
// filas de `activity` en frases con nombres de personas, tipos y etapas, y
// horas de Lima. Puro, para probarlo con vitest.

import type { CaseHistoryRow } from "@/lib/actions/cases";
import { formatSpan } from "@/lib/cases/protection";
import { relativeDayTime } from "./case-card-model";

export interface HistoryLookup {
  members: readonly { userId: string; name: string }[];
  /** Tipos con sus etapas, categorías y motivos (los de ContactCasesView). */
  caseTypes: readonly {
    id: string;
    name: string;
    stages: readonly { id: string; name: string }[];
    categories: readonly { id: string; name: string }[];
    outcomeReasons: readonly { id: string; name: string }[];
  }[];
  teams: readonly { id: string; name: string }[];
}

export interface HistoryItem {
  id: number;
  text: string;
  /** "hoy 15:20", "ayer 10:00", "28 oct 9:00". */
  when: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function short(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Frases del historial, en el mismo orden de las filas (la más reciente
 * primero). Los eventos internos sin interés para el equipo no aparecen.
 */
export function formatHistory(rows: readonly CaseHistoryRow[], lookup: HistoryLookup, now: Date): HistoryItem[] {
  const typeName = (id: string | null) => lookup.caseTypes.find((t) => t.id === id)?.name ?? null;
  const find = <K extends "stages" | "categories" | "outcomeReasons">(key: K, id: string | null) => {
    if (!id) return null;
    for (const t of lookup.caseTypes) {
      const hit = t[key].find((x) => x.id === id);
      if (hit) return hit.name;
    }
    return null;
  };
  const person = (id: string | null) =>
    id ? (lookup.members.find((m) => m.userId === id)?.name ?? "Otra persona") : null;
  const team = (id: string | null) => (id ? (lookup.teams.find((t) => t.id === id)?.name ?? "otro equipo") : null);
  const time = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? relativeDayTime(new Date(iso), now) : null);

  const items: HistoryItem[] = [];
  for (const r of rows) {
    const who = person(r.actorId);
    const actor = who ?? "El sistema";
    const meta = r.meta;
    let text: string | null = null;

    switch (r.type) {
      case "case_opened": {
        const t = typeName(r.toValue);
        text =
          meta.origin === "inbound"
            ? `Se abrió la gestión porque el cliente escribió${t ? ` (${t})` : ""}`
            : `${actor} abrió la gestión${t ? ` de ${t}` : ""}`;
        break;
      }
      case "case_scheduled":
        text = "Se programó la gestión";
        break;
      case "case_activated":
        text = "Se activó la gestión programada";
        break;
      case "case_classified":
        if (meta.field === "category") {
          const from = find("categories", r.fromValue);
          const to = find("categories", r.toValue);
          text = to
            ? from
              ? `${actor} cambió la categoría: ${from} → ${to}`
              : `${actor} puso la categoría ${to}`
            : `${actor} quitó la categoría`;
        } else {
          const from = typeName(r.fromValue);
          const to = typeName(r.toValue) ?? "otro tipo";
          text = from ? `${actor} cambió el tipo: ${from} → ${to}` : `${actor} clasificó la gestión como ${to}`;
        }
        break;
      case "stage_changed": {
        const from = find("stages", r.fromValue);
        const to = find("stages", r.toValue) ?? "otra etapa";
        text = from ? `${actor} cambió la etapa: ${from} → ${to}` : `${actor} pasó la gestión a ${to}`;
        break;
      }
      case "assigned": {
        const to = person(r.toValue) ?? "otra persona";
        text =
          r.toValue && r.toValue === r.actorId
            ? `${to} tomó la gestión`
            : who
              ? `${actor} asignó la gestión a ${to}`
              : `Se asignó la gestión a ${to}`;
        break;
      }
      case "unassigned":
        text = who ? `${actor} devolvió la gestión a la cola` : "La gestión quedó sin responsable";
        break;
      case "transferred":
      case "team_changed": {
        const to = team(r.toValue);
        text = to ? `${who ? `${actor} pasó` : "Pasó"} la gestión al equipo ${to}` : `${actor} dejó la gestión sin equipo`;
        break;
      }
      case "case_closed": {
        const stage = find("stages", str(meta.stage_id)) ?? "cerrada";
        const requester = person(str((meta.close_request as Record<string, unknown> | undefined)?.requested_by));
        const note = str(meta.note);
        text = `${actor} cerró la gestión como «${stage}»${requester && meta.approved_by ? ` a pedido de ${requester}` : ""}${note ? `: ${short(note)}` : ""}`;
        break;
      }
      case "case_reopened":
        text = "Se reabrió porque el cliente volvió a escribir";
        break;
      case "note_added":
        text = `${actor} agregó una nota`;
        break;
      case "first_response": {
        const seconds = typeof meta.seconds === "number" ? meta.seconds : null;
        text = `${actor} respondió por primera vez${seconds !== null ? ` (a los ${formatSpan(seconds * 1000)})` : ""}`;
        break;
      }
      case "next_action_set": {
        const when = time(r.toValue);
        text = when ? `${actor} programó el próximo contacto: ${when}` : `${actor} quitó el próximo contacto`;
        break;
      }
      case "automation_paused":
        text = `${actor} pausó el bot`;
        break;
      case "automation_resumed":
        text = who ? `${actor} reanudó el bot` : "Se reanudó el bot";
        break;
      case "auto_template_sent":
        text = "Se envió la plantilla automática al cliente";
        break;
      case "sla_breached":
        text = `Se superó el objetivo de tiempo (${meta.kind === "first_response" ? "primera respuesta" : "resolución"})`;
        break;
      // Control de reclamos
      case "solution_registered": {
        const note = str(meta.note);
        const when = time(str(meta.commitment_at));
        text = `${actor} registró la solución${note ? `: ${short(note)}` : ""}${when ? ` · compromiso ${when}` : ""}`;
        break;
      }
      case "solution_overdue":
        text =
          meta.kind === "commitment"
            ? "Venció la fecha compromiso de la solución"
            : "Venció el plazo para registrar la solución";
        break;
      case "close_requested": {
        const reason = find("outcomeReasons", str(meta.outcome_reason_id));
        const note = str(meta.note);
        const detail = [reason, note && short(note)].filter(Boolean).join(" · ");
        text = `${actor} pidió cerrar sin solución${detail ? `: ${detail}` : ""}`;
        break;
      }
      case "close_request_approved":
        text = `Pedido de cierre sin solución aprobado por ${actor}`;
        break;
      case "close_request_rejected": {
        const comment = str(meta.comment);
        text = `Pedido de cierre sin solución rechazado por ${actor}${comment ? `: ${short(comment)}` : ""}`;
        break;
      }
    }

    if (text) items.push({ id: r.id, text, when: time(r.createdAt) ?? "" });
  }
  return items;
}
