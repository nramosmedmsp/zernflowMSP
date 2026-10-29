import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  formatDuration,
  type TimelineActivity,
  type TimelineCase,
  type TimelineLookups,
  type TimelineNote,
} from "./timeline";
import type { ActivityType } from "@/lib/types/database";

const lookups: TimelineLookups = {
  users: { "u-ana": "Ana Torres", "u-beto": "Beto Ruiz" },
  teams: { "t-a": "Sede A", "t-b": "Sede B" },
  caseTypes: { "ct-venta": "Venta", "ct-post": "Postventa" },
  stages: { "s-nuevo": "Nuevo interesado", "s-aseso": "Asesorando", "s-ganada": "Venta cerrada" },
  categories: { "cat-1": "Precio" },
  outcomeReasons: { "r-1": "Compró en tienda" },
  contactTypes: { "k-lead": "Lead", "k-cliente": "Cliente" },
};

let seq = 0;
function act(partial: Partial<TimelineActivity> & Pick<TimelineActivity, "type" | "created_at">): TimelineActivity {
  seq += 1;
  return { id: seq, actor_id: null, case_id: null, from_value: null, to_value: null, meta: {}, ...partial };
}

const venta: TimelineCase = {
  id: "g-1",
  case_type_id: "ct-venta",
  status: "open",
  closed_at: null,
  outcome_reason_id: null,
  outcome_note: null,
  closed_by: null,
};

function build(activity: TimelineActivity[], extra: { notes?: TimelineNote[]; cases?: TimelineCase[] } = {}) {
  return buildTimeline({ activity, notes: extra.notes ?? [], cases: extra.cases ?? [venta], lookups });
}

describe("textos de la línea de tiempo", () => {
  it("apertura de gestión con su origen", () => {
    const [item] = build([
      act({ type: "case_opened", case_id: "g-1", to_value: "ct-venta", actor_id: "u-ana", created_at: "2026-10-18T15:00:00Z", meta: { origin: "manual" } }),
    ]);
    expect(item).toMatchObject({
      title: "Se abrió la gestión Venta",
      detail: "Origen: manual",
      actor: "Ana Torres",
      caseLabel: "Venta",
      kind: "case",
    });
  });

  it("gestión sin tipo se llama 'Sin clasificar'", () => {
    const [item] = build([act({ type: "case_opened", case_id: "g-1", created_at: "2026-10-18T15:00:00Z", meta: { origin: "inbound" } })]);
    expect(item.title).toBe("Se abrió la gestión Sin clasificar");
    expect(item.detail).toBe("Origen: mensaje entrante");
    expect(item.actor).toBe("Sistema");
  });

  it("clasificación, categoría y etapa", () => {
    const items = build([
      act({ type: "case_classified", case_id: "g-1", from_value: null, to_value: "ct-venta", created_at: "2026-10-18T15:01:00Z" }),
      act({ type: "case_classified", case_id: "g-1", to_value: "cat-1", created_at: "2026-10-18T15:02:00Z", meta: { field: "category" } }),
      act({ type: "stage_changed", case_id: "g-1", from_value: "s-nuevo", to_value: "s-aseso", created_at: "2026-10-18T15:03:00Z" }),
    ]);
    expect(items.map((i) => i.title)).toEqual([
      "Etapa: Nuevo interesado → Asesorando",
      "Categoría: Sin categoría → Precio",
      "Gestión clasificada: Sin clasificar → Venta",
    ]);
  });

  it("asignaciones: manual, automática, transferencia y devolución a la cola", () => {
    const items = build([
      act({ type: "assigned", case_id: "g-1", to_value: "u-ana", actor_id: "u-beto", meta: { via: "manual" }, created_at: "2026-10-18T15:01:00Z" }),
      act({ type: "assigned", case_id: "g-1", to_value: "u-beto", meta: { via: "round_robin" }, created_at: "2026-10-18T15:02:00Z" }),
      act({ type: "transferred", case_id: "g-1", from_value: "t-a", to_value: "t-b", created_at: "2026-10-18T15:03:00Z" }),
      act({ type: "unassigned", case_id: "g-1", from_value: "u-ana", meta: { reason: "transferred" }, created_at: "2026-10-18T15:04:00Z" }),
      act({ type: "unassigned", case_id: "g-1", from_value: "u-ana", created_at: "2026-10-18T15:05:00Z" }),
    ]).reverse();
    expect(items[0]).toMatchObject({ title: "Se asignó a Ana Torres", actor: "Beto Ruiz", kind: "assignment" });
    expect(items[1]).toMatchObject({ title: "Se asignó automáticamente a Beto Ruiz", detail: "Reparto: reparto por turnos" });
    expect(items[2]).toMatchObject({ title: "Se transfirió al equipo Sede B", detail: "Antes: Sede A" });
    expect(items[3]).toMatchObject({ title: "Quedó sin responsable al transferirla", detail: "Antes: Ana Torres" });
    expect(items[4].title).toBe("Se devolvió a la cola, sin responsable");
  });

  it("cierre con resultado, motivo, nota y fecha clave", () => {
    const [item] = build([
      act({
        type: "case_closed",
        case_id: "g-1",
        from_value: "s-aseso",
        to_value: "won",
        actor_id: "u-ana",
        created_at: "2026-10-18T16:00:00Z",
        meta: { stage_id: "s-ganada", outcome_reason_id: "r-1", note: "Pagó con Yape", key_date: "2026-11-13" },
      }),
    ]);
    expect(item.title).toBe("Se cerró la gestión como ganada");
    expect(item.tone).toBe("won");
    expect(item.kind).toBe("closed");
    expect(item.detail).toBe(
      "Etapa final: Venta cerrada · Motivo: Compró en tienda · Nota: Pagó con Yape · Fecha clave: 13 nov 2026",
    );
  });

  it("cierre perdido tiene tono 'lost'", () => {
    const [item] = build([act({ type: "case_closed", case_id: "g-1", to_value: "lost", created_at: "2026-10-18T16:00:00Z" })]);
    expect(item).toMatchObject({ title: "Se cerró la gestión como perdida", tone: "lost", detail: null });
  });

  it("programación, reprogramación, activación y reapertura", () => {
    const items = build([
      act({ type: "case_scheduled", case_id: "g-1", to_value: "2026-11-12T14:00:00Z", created_at: "2026-10-18T15:01:00Z" }),
      act({ type: "case_scheduled", case_id: "g-1", from_value: "2026-11-12T14:00:00Z", to_value: "2026-11-20T14:00:00Z", meta: { rescheduled: true }, created_at: "2026-10-18T15:02:00Z" }),
      act({ type: "case_activated", case_id: "g-1", from_value: "scheduled", to_value: "open", created_at: "2026-10-18T15:03:00Z" }),
      act({ type: "case_reopened", case_id: "g-1", from_value: "won", to_value: "open", created_at: "2026-10-18T15:04:00Z" }),
    ]).reverse();
    expect(items[0].title).toBe("Se programó la gestión Venta para el 12 nov 2026");
    expect(items[1]).toMatchObject({ title: "Se reprogramó la gestión Venta para el 20 nov 2026", detail: "Antes: 12 nov 2026" });
    expect(items[2].title).toBe("Se activó la gestión programada Venta");
    expect(items[3]).toMatchObject({ title: "Se reabrió la gestión", detail: "Estaba ganada" });
  });

  it("cambios del contacto: tipo, responsable y equipo", () => {
    const items = build(
      [
        act({ type: "contact_type_changed", from_value: "k-lead", to_value: "k-cliente", meta: { reason: "rule" }, created_at: "2026-10-18T15:01:00Z" }),
        act({ type: "contact_type_changed", to_value: "k-lead", meta: { reason: "default" }, created_at: "2026-10-18T15:02:00Z" }),
        act({ type: "owner_changed", to_value: "u-ana", meta: { reason: "first_assignment" }, created_at: "2026-10-18T15:03:00Z" }),
        act({ type: "owner_changed", from_value: "u-ana", to_value: "u-beto", actor_id: "u-ana", meta: { reason: "manual" }, created_at: "2026-10-18T15:04:00Z" }),
        act({ type: "owner_changed", from_value: "u-beto", created_at: "2026-10-18T15:05:00Z" }),
        act({ type: "team_changed", to_value: "t-a", meta: { reason: "routing" }, created_at: "2026-10-18T15:06:00Z" }),
      ],
      { cases: [] },
    ).reverse();
    expect(items[0]).toMatchObject({ title: "Tipo de contacto: Lead → Cliente", detail: "Por una regla de la gestión", kind: "contact" });
    expect(items[1]).toMatchObject({ title: "Tipo de contacto: Sin tipo → Lead", detail: "Tipo por defecto" });
    expect(items[2]).toMatchObject({ title: "Responsable: Ana Torres", detail: "Primera asignación" });
    expect(items[3]).toMatchObject({ title: "Responsable: Ana Torres → Beto Ruiz", detail: "Cambio manual" });
    expect(items[4].title).toBe("Se quitó el responsable (era Beto Ruiz)");
    expect(items[5]).toMatchObject({ title: "Equipo: Sin equipo → Sede A", detail: "Según el reparto" });
    expect(items[0].caseLabel).toBeNull();
  });

  it("primera respuesta y próximo contacto", () => {
    const items = build([
      act({ type: "first_response", case_id: "g-1", meta: { seconds: 4500 }, created_at: "2026-10-18T15:01:00Z" }),
      act({ type: "next_action_set", case_id: "g-1", to_value: "2026-10-20T14:00:00Z", meta: { note: "Llamar por la talla" }, created_at: "2026-10-18T15:02:00Z" }),
      act({ type: "next_action_set", case_id: "g-1", from_value: "2026-10-20T14:00:00Z", created_at: "2026-10-18T15:03:00Z" }),
    ]).reverse();
    expect(items[0].title).toBe("Primera respuesta en 1 h 15 min");
    expect(items[1]).toMatchObject({ title: "Próximo contacto: 20 oct 2026, 09:00", detail: "Nota: Llamar por la talla" });
    expect(items[2].title).toBe("Se quitó el próximo contacto");
  });

  it("tipos desconocidos no rompen la línea de tiempo", () => {
    const [item] = build([act({ type: "algo_nuevo", created_at: "2026-10-18T15:00:00Z" })]);
    expect(item).toMatchObject({ title: "Actividad: algo_nuevo", kind: "system", tone: "muted" });
  });

  it("ids que ya no existen usan textos neutros", () => {
    const [item] = build([
      act({ type: "assigned", case_id: "g-1", to_value: "u-borrado", meta: { via: "manual" }, created_at: "2026-10-18T15:00:00Z" }),
    ]);
    expect(item.title).toBe("Se asignó a Alguien");
  });
});

describe("notas y gestiones cerradas", () => {
  it("la nota aparece con su texto y su aviso de actividad no se repite", () => {
    const items = build(
      [
        act({ type: "note_added", case_id: "g-1", actor_id: "u-ana", meta: { note_id: "n-1" }, created_at: "2026-10-18T15:00:00Z" }),
        act({ type: "note_added", case_id: "g-1", actor_id: "u-ana", meta: { note_id: "n-borrada" }, created_at: "2026-10-18T15:30:00Z" }),
      ],
      { notes: [{ id: "n-1", case_id: "g-1", author_id: "u-ana", body: "Prefiere WhatsApp\npor la tarde", created_at: "2026-10-18T15:00:00Z" }] },
    );
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Se agregó una nota interna");
    expect(items[1]).toMatchObject({
      key: "note-n-1",
      kind: "note",
      tone: "note",
      title: "Nota interna",
      detail: "Prefiere WhatsApp\npor la tarde",
      actor: "Ana Torres",
      caseLabel: "Venta",
    });
  });

  it("una gestión cerrada sin aviso en actividad se muestra con su resultado", () => {
    const closed: TimelineCase = {
      ...venta,
      id: "g-2",
      case_type_id: "ct-post",
      status: "lost",
      closed_at: "2026-09-01T12:00:00Z",
      outcome_reason_id: "r-1",
      outcome_note: "No respondió",
      closed_by: "u-beto",
    };
    const items = build([], { cases: [venta, closed] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "case-g-2",
      title: "Se cerró la gestión como perdida",
      tone: "lost",
      detail: "Motivo: Compró en tienda · Nota: No respondió",
      actor: "Beto Ruiz",
      caseLabel: "Postventa",
    });
  });

  it("no duplica el cierre si ya está en la actividad", () => {
    const closed: TimelineCase = { ...venta, status: "won", closed_at: "2026-10-18T16:00:00Z" };
    const items = build(
      [act({ type: "case_closed", case_id: "g-1", to_value: "won", created_at: "2026-10-18T16:00:00Z" })],
      { cases: [closed] },
    );
    expect(items).toHaveLength(1);
    expect(items[0].key).toMatch(/^activity-/);
  });

  it("ordena de lo más reciente a lo más antiguo, mezclando las tres fuentes", () => {
    const closed: TimelineCase = { ...venta, id: "g-2", status: "resolved", closed_at: "2026-10-18T17:00:00Z" };
    const items = build(
      [
        act({ type: "case_opened", case_id: "g-1", to_value: "ct-venta", created_at: "2026-10-18T15:00:00Z" }),
        act({ type: "stage_changed", case_id: "g-1", from_value: "s-nuevo", to_value: "s-aseso", created_at: "2026-10-18T16:00:00Z" }),
      ],
      {
        notes: [{ id: "n-1", case_id: "g-1", author_id: "u-ana", body: "x", created_at: "2026-10-18T15:30:00Z" }],
        cases: [venta, closed],
      },
    );
    expect(items.map((i) => i.key.split("-")[0])).toEqual(["case", "activity", "note", "activity"]);
    expect(items.map((i) => i.at)).toEqual([
      "2026-10-18T17:00:00Z",
      "2026-10-18T16:00:00Z",
      "2026-10-18T15:30:00Z",
      "2026-10-18T15:00:00Z",
    ]);
  });

  it("con la misma hora, lo registrado después va primero", () => {
    const at = "2026-10-18T15:00:00Z";
    const items = build([
      act({ type: "case_opened", case_id: "g-1", to_value: "ct-venta", created_at: at }),
      act({ type: "assigned", case_id: "g-1", to_value: "u-ana", meta: { via: "manual" }, created_at: at }),
    ]);
    expect(items.map((i) => i.title)).toEqual(["Se asignó a Ana Torres", "Se abrió la gestión Venta"]);
  });
});

describe("formatDuration", () => {
  it("formatea segundos, minutos, horas y días", () => {
    expect(formatDuration(20)).toBe("menos de 1 min");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(4500)).toBe("1 h 15 min");
    expect(formatDuration(3 * 86400 + 100)).toBe("3 d");
    expect(formatDuration(-1)).toBe("");
  });
});

describe("textos en español para todos los tipos de actividad (M-30)", () => {
  // Con Record, agregar un ActivityType nuevo sin ponerlo aquí rompe tsc.
  const ALL_TYPES: Record<ActivityType, true> = {
    case_opened: true,
    case_scheduled: true,
    case_activated: true,
    case_classified: true,
    stage_changed: true,
    assigned: true,
    unassigned: true,
    transferred: true,
    case_closed: true,
    case_reopened: true,
    contact_type_changed: true,
    owner_changed: true,
    team_changed: true,
    note_added: true,
    first_response: true,
    next_action_set: true,
    automation_paused: true,
    automation_resumed: true,
    config_changed: true,
    off_hours_reply_sent: true,
    auto_template_sent: true,
    auto_template_failed: true,
    auto_template_skipped: true,
    contacts_imported: true,
    sequence_step_failed: true,
    human_reply: true,
    sla_breached: true,
    solution_registered: true,
    solution_overdue: true,
    close_requested: true,
    close_request_approved: true,
    close_request_rejected: true,
    complaint_dismissed: true,
  };

  it.each(Object.keys(ALL_TYPES))("%s tiene texto en español", (type) => {
    const items = build([act({ type, case_id: "g-1", created_at: "2026-10-28T15:00:00Z" })]);
    // note_added sin nota asociada igual muestra el aviso.
    expect(items).toHaveLength(1);
    expect(items[0].title).not.toMatch(/Actividad:/);
    expect(items[0].title).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(items[0].title.length).toBeGreaterThan(8);
  });

  it("el control de reclamos se lee en claro", () => {
    const [requested] = build([
      act({ type: "close_requested", case_id: "g-1", created_at: "2026-10-28T15:00:00Z", meta: { note: "Cliente molesto", stage_id: "s-ganada" } }),
    ]);
    expect(requested.title).toBe("Se pidió cerrar la gestión sin solución");
    expect(requested.detail).toContain("Nota: Cliente molesto");
    expect(requested.detail).toContain("Etapa final: Venta cerrada");

    const [overdue] = build([act({ type: "solution_overdue", case_id: "g-1", created_at: "2026-10-28T15:00:00Z", meta: { kind: "deadline", hours: 24 } })]);
    expect(overdue.title).toBe("Venció el plazo para registrar la solución");
    expect(overdue.detail).toBe("Plazo: 24 h");
  });
});
