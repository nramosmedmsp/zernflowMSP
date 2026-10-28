import { describe, expect, it } from "vitest";
import type { CaseHistoryRow } from "@/lib/actions/cases";
import { formatHistory, type HistoryLookup } from "./case-history-model";

// Miércoles 28 oct 2026, 10:00 en Lima.
const NOW = new Date("2026-10-28T15:00:00Z");

const lookup: HistoryLookup = {
  members: [
    { userId: "marco", name: "Marco" },
    { userId: "ana", name: "Ana" },
    { userId: "luis", name: "Luis" },
  ],
  caseTypes: [
    {
      id: "pv",
      name: "Postventa",
      stages: [
        { id: "pv-new", name: "Nueva" },
        { id: "pv-work", name: "En gestión" },
        { id: "pv-lost", name: "Sin solución" },
      ],
      categories: [{ id: "cat-broken", name: "Producto dañado" }],
      outcomeReasons: [{ id: "r-silent", name: "Cliente no responde" }],
    },
    { id: "venta", name: "Venta", stages: [], categories: [], outcomeReasons: [] },
  ],
  teams: [{ id: "t1", name: "Postventa" }],
};

let n = 0;
function row(type: string, extra: Partial<CaseHistoryRow> = {}): CaseHistoryRow {
  n += 1;
  return {
    id: n,
    type,
    actorId: null,
    fromValue: null,
    toValue: null,
    meta: {},
    // 20:20 UTC = 15:20 en Lima, hoy.
    createdAt: "2026-10-28T20:20:00Z",
    ...extra,
  };
}

const text = (r: CaseHistoryRow) => formatHistory([r], lookup, NOW)[0]?.text;

describe("formatHistory", () => {
  it("cambio de tipo con nombres y hora de Lima", () => {
    const items = formatHistory(
      [row("case_classified", { actorId: "marco", fromValue: "pv", toValue: "venta", createdAt: "2026-10-28T20:20:00Z" })],
      lookup,
      new Date("2026-10-28T21:00:00Z"),
    );
    expect(items).toEqual([{ id: expect.any(Number), text: "Marco cambió el tipo: Postventa → Venta", when: "hoy 15:20" }]);
  });

  it("clasificar una gestión sin tipo y la categoría", () => {
    expect(text(row("case_classified", { actorId: "ana", toValue: "pv" }))).toBe("Ana clasificó la gestión como Postventa");
    expect(text(row("case_classified", { actorId: "ana", toValue: "cat-broken", meta: { field: "category" } }))).toBe(
      "Ana puso la categoría Producto dañado",
    );
    expect(text(row("case_classified", { actorId: "ana", fromValue: "cat-broken", meta: { field: "category" } }))).toBe(
      "Ana quitó la categoría",
    );
  });

  it("apertura, reapertura y registro de la solución", () => {
    expect(text(row("case_opened", { toValue: "pv", meta: { origin: "inbound" } }))).toBe(
      "Se abrió la gestión porque el cliente escribió (Postventa)",
    );
    expect(text(row("case_opened", { actorId: "ana", toValue: "venta", meta: { origin: "manual" } }))).toBe("Ana abrió la gestión de Venta");
    expect(text(row("case_reopened"))).toBe("Se reabrió porque el cliente volvió a escribir");
    expect(
      text(
        row("solution_registered", {
          actorId: "ana",
          meta: { note: "Cambio del producto", commitment_at: "2026-10-30T23:00:00Z" },
        }),
      ),
    ).toBe("Ana registró la solución: Cambio del producto · compromiso vie 18:00");
  });

  it("pedido de cierre: pedido, aprobado y rechazado", () => {
    expect(
      text(row("close_requested", { actorId: "ana", meta: { outcome_reason_id: "r-silent", note: "No contesta" } })),
    ).toBe("Ana pidió cerrar sin solución: Cliente no responde · No contesta");
    expect(text(row("close_request_approved", { actorId: "luis" }))).toBe("Pedido de cierre sin solución aprobado por Luis");
    expect(text(row("close_request_rejected", { actorId: "luis" }))).toBe("Pedido de cierre sin solución rechazado por Luis");
    expect(text(row("close_request_rejected", { actorId: "luis", meta: { comment: "Llámalo antes" } }))).toBe(
      "Pedido de cierre sin solución rechazado por Luis: Llámalo antes",
    );
  });

  it("cierre, también el aprobado a pedido de otra persona", () => {
    expect(text(row("case_closed", { actorId: "ana", meta: { stage_id: "pv-lost", note: "Sin respuesta" } }))).toBe(
      "Ana cerró la gestión como «Sin solución»: Sin respuesta",
    );
    expect(
      text(
        row("case_closed", {
          actorId: "luis",
          meta: { stage_id: "pv-lost", approved_by: "luis", close_request: { requested_by: "ana" } },
        }),
      ),
    ).toBe("Luis cerró la gestión como «Sin solución» a pedido de Ana");
  });

  it("etapas, responsables y equipo", () => {
    expect(text(row("stage_changed", { actorId: "ana", fromValue: "pv-new", toValue: "pv-work" }))).toBe(
      "Ana cambió la etapa: Nueva → En gestión",
    );
    expect(text(row("assigned", { actorId: "luis", toValue: "ana" }))).toBe("Luis asignó la gestión a Ana");
    expect(text(row("assigned", { actorId: "ana", toValue: "ana" }))).toBe("Ana tomó la gestión");
    expect(text(row("assigned", { toValue: "ana", meta: { via: "auto" } }))).toBe("Se asignó la gestión a Ana");
    expect(text(row("unassigned", { actorId: "ana" }))).toBe("Ana devolvió la gestión a la cola");
    expect(text(row("transferred", { actorId: "luis", toValue: "t1" }))).toBe("Luis pasó la gestión al equipo Postventa");
  });

  it("avisos del sistema", () => {
    expect(text(row("solution_overdue", { meta: { kind: "deadline" } }))).toBe("Venció el plazo para registrar la solución");
    expect(text(row("solution_overdue", { meta: { kind: "commitment" } }))).toBe("Venció la fecha compromiso de la solución");
    expect(text(row("sla_breached", { meta: { kind: "first_response" } }))).toBe(
      "Se superó el objetivo de tiempo (primera respuesta)",
    );
  });

  it("próximo contacto y primera respuesta", () => {
    expect(text(row("next_action_set", { actorId: "ana", toValue: "2026-10-29T14:00:00Z" }))).toBe(
      "Ana programó el próximo contacto: mañana 9:00",
    );
    expect(text(row("next_action_set", { actorId: "ana" }))).toBe("Ana quitó el próximo contacto");
    expect(text(row("first_response", { actorId: "ana", meta: { seconds: 300 } }))).toBe("Ana respondió por primera vez (a los 5 min)");
  });

  it("omite lo interno, mantiene el orden y usa «Otra persona» para quien ya no está", () => {
    const rows = [
      row("human_reply", { actorId: "ana" }),
      row("note_added", { actorId: "fantasma" }),
      row("config_changed"),
      row("case_reopened"),
    ];
    const items = formatHistory(rows, lookup, NOW);
    expect(items.map((i) => i.text)).toEqual(["Otra persona agregó una nota", "Se reabrió porque el cliente volvió a escribir"]);
  });

  it("fechas antiguas", () => {
    const items = formatHistory([row("case_reopened", { createdAt: "2026-10-20T14:00:00Z" })], lookup, NOW);
    expect(items[0].when).toBe("20 oct 9:00");
  });
});
