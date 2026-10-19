import { describe, expect, it } from "vitest";
import { complianceOf } from "./compliance";
import { computeMetrics } from "./compute";
import { toCsv } from "./csv";
import { formatDmy, limaWeekdayHour } from "./day";
import { agentsCsv } from "./export";
import { buildFunnel } from "./funnel";
import { buildOverdue, staleStageDaysFromSettings } from "./overdue";
import { parseMetricFilters, periodRange } from "./period";
import { firstResponseSamples, replySamples, resolutionSamples } from "./samples";
import { formatDuration, median, percentile, timeStats } from "./stats";
import { buildStageTimeline, groupActivityByCase } from "./timeline";
import type { MetricActivity, MetricCase, MetricCaseType, MetricStage, MetricsInput } from "./types";
import { buildVolume } from "./volume";

const H = 3_600_000;
// Mediodía de Lima del lunes 12 de octubre de 2026 = 17:00 UTC.
const NOW = new Date("2026-10-19T17:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-10-12T15:00:00Z");

const noSchedule = () => ({ hours: null, holidays: new Set<string>() });

function mkCase(over: Partial<MetricCase> = {}): MetricCase {
  return {
    id: "c1",
    contact_id: "k1",
    case_type_id: "t1",
    stage_id: "s1",
    status: "open",
    origin: "inbound",
    team_id: null,
    assignee_id: "u1",
    outcome_reason_id: null,
    opened_at: iso(T0),
    first_response_at: null,
    waiting_since: null,
    closed_at: null,
    next_action_at: null,
    created_at: iso(T0),
    ...over,
  };
}

function act(over: Partial<MetricActivity> & { type: string; created_at: string }): MetricActivity {
  return { case_id: "c1", actor_id: "u1", from_value: null, to_value: null, meta: {}, ...over };
}

const stages: MetricStage[] = [
  { id: "s1", case_type_id: "t1", name: "Nuevo", position: 0, kind: "open" },
  { id: "s2", case_type_id: "t1", name: "Cotizado", position: 1, kind: "open" },
  { id: "s3", case_type_id: "t1", name: "Pago", position: 2, kind: "open" },
  { id: "sw", case_type_id: "t1", name: "Ganada", position: 3, kind: "won" },
];
const types: MetricCaseType[] = [
  { id: "t1", name: "Venta", is_proactive: false, sla_first_response_minutes: 10, sla_resolution_hours: 48 },
  { id: "t2", name: "Renovación", is_proactive: true, sla_first_response_minutes: null, sla_resolution_hours: null },
];

describe("estadística", () => {
  it("mediana, p90 y promedio", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1);
    expect(timeStats([10, 20, 60])).toEqual({ count: 3, mean: 30, median: 20, p90: 52 });
    expect(timeStats([])).toEqual({ count: 0, mean: null, median: null, p90: null });
  });

  it("formatea duraciones", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(5 * 60)).toBe("5 min");
    expect(formatDuration(130 * 60)).toBe("2 h 10 min");
    expect(formatDuration(28 * 3600)).toBe("1 d 4 h");
  });
});

describe("periodos y filtros", () => {
  it("hoy y 7 días en hora de Lima", () => {
    const r = periodRange({ period: "today" }, new Date("2026-10-20T03:00:00Z")); // 22:00 del 19 en Lima
    expect(r.startDay).toBe("2026-10-19");
    expect(r.endDay).toBe("2026-10-19");
    expect(r.startIso).toBe("2026-10-19T05:00:00.000Z");
    expect(r.endIso).toBe("2026-10-20T05:00:00.000Z");
    const w = periodRange({ period: "7d" }, NOW);
    expect(w.startDay).toBe("2026-10-13");
    expect(w.days).toBe(7);
  });

  it("el personalizado inválido cae a 30 días", () => {
    expect(periodRange({ period: "custom", from: "2026-10-05", to: "2026-10-01" }, NOW).days).toBe(30);
    expect(periodRange({ period: "custom", from: "2026-10-01", to: "2026-10-05" }, NOW).days).toBe(5);
  });

  it("lee los filtros de la URL e ignora lo inválido", () => {
    expect(parseMetricFilters({ period: "xx", origin: "otro", type: "t1", agent: ["u1"] })).toMatchObject({
      period: "30d",
      origin: undefined,
      caseTypeId: "t1",
      assigneeId: "u1",
    });
  });
});

describe("línea de tiempo de etapas", () => {
  it("reconstruye los tramos hasta el cierre", () => {
    const c = mkCase({ status: "won", stage_id: "sw", closed_at: iso(T0 + 10 * H) });
    const acts = [
      act({ type: "case_opened", created_at: iso(T0) }),
      act({ type: "stage_changed", from_value: "s1", to_value: "s2", created_at: iso(T0 + 2 * H) }),
      act({ type: "stage_changed", from_value: "s2", to_value: "s3", created_at: iso(T0 + 5 * H) }),
      act({ type: "stage_changed", from_value: "s3", to_value: "sw", created_at: iso(T0 + 10 * H) }),
    ];
    const seg = buildStageTimeline(c, acts, NOW.getTime());
    expect(seg.map((s) => [s.stageId, (s.endMs - s.startMs) / H, s.ongoing])).toEqual([
      ["s1", 2, false],
      ["s2", 3, false],
      ["s3", 5, false],
      ["sw", 0, false],
    ]);
  });

  it("sin cambios usa la etapa actual y sigue en curso", () => {
    const seg = buildStageTimeline(mkCase(), [], T0 + 4 * H);
    expect(seg).toEqual([{ stageId: "s1", startMs: T0, endMs: T0 + 4 * H, ongoing: true }]);
  });
});

describe("tiempos de respuesta", () => {
  const range = periodRange({ period: "30d" }, NOW);
  const cases = [mkCase({ id: "c1" }), mkCase({ id: "c2" })];

  it("primera respuesta: usa first_response y, si falta, la primera human_reply", () => {
    const by = groupActivityByCase([
      act({ case_id: "c1", type: "first_response", created_at: iso(T0 + 600_000), meta: { seconds: 600, business_seconds: 300, waiting_since: iso(T0) } }),
      act({ case_id: "c2", type: "human_reply", created_at: iso(T0 + 120_000), meta: { seconds: 120, waiting_since: iso(T0) } }),
      act({ case_id: "c2", type: "human_reply", created_at: iso(T0 + 900_000), meta: { seconds: 60, waiting_since: iso(T0 + 840_000) } }),
    ]);
    const s = firstResponseSamples(cases, by, noSchedule, range);
    expect(s.map((x) => [x.caseId, x.clockSeconds, x.businessSeconds])).toEqual([
      ["c1", 600, 300],
      ["c2", 120, 120],
    ]);
    expect(replySamples(cases, by, noSchedule, range)).toHaveLength(2);
  });

  it("calcula el tiempo en horario cuando falta business_seconds", () => {
    // Lunes 09:00-10:00 de Lima abierto; espera de 08:00 a 10:00 = 60 min hábiles.
    const hours = { mon: [["09:00", "10:00"]] };
    const sch = () => ({ hours: hours as never, holidays: new Set<string>() });
    const waiting = "2026-10-12T13:00:00Z"; // 08:00 Lima
    const at = "2026-10-12T15:00:00Z"; // 10:00 Lima
    const by = groupActivityByCase([
      act({ type: "first_response", created_at: at, meta: { seconds: 7200, waiting_since: waiting } }),
    ]);
    const [s] = firstResponseSamples([mkCase()], by, sch, range);
    expect(s.clockSeconds).toBe(7200);
    expect(s.businessSeconds).toBe(3600);
  });

  it("resolución: solo cerradas del periodo y sin canceladas", () => {
    const closed = mkCase({ id: "a", status: "won", closed_at: iso(T0 + 3 * H) });
    const cancelled = mkCase({ id: "b", status: "cancelled", closed_at: iso(T0 + 3 * H) });
    const old = mkCase({ id: "c", status: "lost", closed_at: "2026-01-01T00:00:00Z", opened_at: "2025-12-31T00:00:00Z" });
    const s = resolutionSamples([closed, cancelled, old], noSchedule, range);
    expect(s).toHaveLength(1);
    expect(s[0].clockSeconds).toBe(3 * 3600);
  });
});

describe("embudo", () => {
  it("cuenta cuántas llegaron a cada etapa y el paso entre etapas", () => {
    const a = mkCase({ id: "a", status: "won", stage_id: "sw", closed_at: iso(T0 + 10 * H) });
    const b = mkCase({ id: "b", status: "lost", stage_id: "s2", closed_at: iso(T0 + 4 * H) });
    const c = mkCase({ id: "c", stage_id: "s1" });
    const by = groupActivityByCase([
      act({ case_id: "a", type: "stage_changed", from_value: "s1", to_value: "s2", created_at: iso(T0 + 2 * H) }),
      act({ case_id: "a", type: "stage_changed", from_value: "s2", to_value: "s3", created_at: iso(T0 + 5 * H) }),
      act({ case_id: "a", type: "stage_changed", from_value: "s3", to_value: "sw", created_at: iso(T0 + 10 * H) }),
      act({ case_id: "b", type: "stage_changed", from_value: "s1", to_value: "s2", created_at: iso(T0 + 1 * H) }),
    ]);
    const [f] = buildFunnel([a, b, c], by, stages, types, noSchedule, NOW.getTime());
    expect(f.total).toBe(3);
    expect([f.won, f.lost, f.resolved, f.other]).toEqual([1, 1, 0, 1]);
    expect(f.stages.map((s) => s.reached)).toEqual([3, 2, 1]);
    expect(f.stages.map((s) => s.passPct)).toEqual([null, 67, 50]);
    // Etapa 1: tramos terminados de a (2 h) y b (1 h); el de c sigue en curso.
    expect(f.stages[0].clock.count).toBe(2);
    expect(f.stages[0].clock.median).toBe(1.5 * 3600);
  });
});

describe("cumplimiento", () => {
  it("solo cuenta tipos con objetivo", () => {
    const caseById = new Map([
      ["c1", mkCase({ id: "c1" })],
      ["c2", mkCase({ id: "c2" })],
      ["c3", mkCase({ id: "c3", case_type_id: "t2" })],
    ]);
    const sample = (caseId: string, business: number) => ({ caseId, actorId: null, atMs: 0, clockSeconds: business, businessSeconds: business });
    const r = complianceOf([sample("c1", 300), sample("c2", 900), sample("c3", 1)], [sample("c1", 47 * 3600), sample("c2", 49 * 3600)], caseById, types);
    expect(r.firstResponse).toEqual({ within: 1, total: 2, pct: 50 });
    expect(r.resolution).toEqual({ within: 1, total: 2, pct: 50 });
    expect(complianceOf([], [], caseById, types).firstResponse.pct).toBeNull();
  });
});

describe("atrasados", () => {
  it("detecta próxima acción vencida y etapa estancada con N configurable", () => {
    const nowMs = NOW.getTime();
    const day = 24 * H;
    const venc = mkCase({ id: "v", opened_at: iso(nowMs - 3 * day), next_action_at: iso(nowMs - 2 * day - H) });
    const stale = mkCase({ id: "s", opened_at: iso(nowMs - 9 * day) });
    const fresh = mkCase({ id: "f", opened_at: iso(nowMs - 2 * day), next_action_at: iso(nowMs + day) });
    const closed = mkCase({ id: "x", status: "won", opened_at: iso(nowMs - 30 * day), closed_at: iso(nowMs - day) });
    const movedRecently = mkCase({ id: "m", opened_at: iso(nowMs - 20 * day) });
    const by = groupActivityByCase([
      act({ case_id: "m", type: "stage_changed", from_value: "s1", to_value: "s2", created_at: iso(nowMs - 1 * day) }),
    ]);
    const items = buildOverdue([venc, stale, fresh, closed, movedRecently], by, stages, types, 7, nowMs);
    expect(items.map((i) => i.caseId)).toEqual(["s", "v"]);
    expect(items[1].reasons).toEqual(["next_action"]);
    expect(items[1].daysOverdue).toBe(2);
    expect(items[0].reasons).toEqual(["stale_stage"]);
    expect(buildOverdue([stale], new Map(), stages, types, 10, nowMs)).toHaveLength(0);
  });

  it("lee stale_stage_days de los ajustes con 7 por defecto", () => {
    expect(staleStageDaysFromSettings(undefined)).toBe(7);
    expect(staleStageDaysFromSettings({ stale_stage_days: 3 })).toBe(3);
    expect(staleStageDaysFromSettings({ stale_stage_days: 0 })).toBe(7);
    expect(staleStageDaysFromSettings({ stale_stage_days: "5" })).toBe(7);
    expect(staleStageDaysFromSettings({ stale_stage_days: 2.5 })).toBe(7);
  });
});

describe("volumen en hora de Lima", () => {
  it("un mensaje a las 02:30 UTC del martes cae en el lunes 21:30 de Lima", () => {
    expect(limaWeekdayHour("2026-10-13T02:30:00Z")).toEqual({ weekday: 0, hour: 21 });
    expect(limaWeekdayHour("2026-10-18T15:00:00Z")).toEqual({ weekday: 6, hour: 10 });
  });

  it("arma la matriz día x hora y la serie diaria", () => {
    const range = periodRange({ period: "7d" }, NOW);
    const v = buildVolume(
      [
        { created_at: "2026-10-13T02:30:00Z", platform: "whatsapp" }, // lun 12, 21:30
        { created_at: "2026-10-13T02:45:00Z", platform: null },
        { created_at: "2026-09-01T00:00:00Z", platform: null }, // fuera del periodo
      ],
      [mkCase({ opened_at: "2026-10-14T15:00:00Z" })], // mié 14, 10:00 -> fuera de 7d? (desde 13)
      range,
    );
    expect(v.totalMessages).toBe(0); // el lunes 12 queda antes del periodo (13 a 19)
    const range2 = periodRange({ period: "custom", from: "2026-10-12", to: "2026-10-19" }, NOW);
    const v2 = buildVolume(
      [
        { created_at: "2026-10-13T02:30:00Z", platform: "whatsapp" },
        { created_at: "2026-10-13T02:45:00Z", platform: null },
      ],
      [mkCase({ opened_at: "2026-10-14T15:00:00Z" })],
      range2,
    );
    expect(v2.messagesMatrix[0][21]).toBe(2);
    expect(v2.casesMatrix[2][10]).toBe(1);
    expect(v2.maxMessages).toBe(2);
    expect(v2.daily.find((d) => d.day === "2026-10-12")?.messages).toBe(2);
    expect(v2.daily).toHaveLength(8);
  });
});

describe("CSV", () => {
  it("usa BOM, punto y coma, comillas y coma decimal", () => {
    const csv = toCsv(["Nombre", "Valor"], [["Ana; \"la jefa\"", 1.5], ["=SUMA(A1)", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Nombre;Valor\r\n"Ana; ""la jefa""";1,5\r\n\'=SUMA(A1);\r\n');
  });

  it("fechas dd/mm/aaaa en hora de Lima", () => {
    expect(formatDmy("2026-10-13T02:30:00Z")).toBe("12/10/2026");
    expect(formatDmy(null)).toBe("");
    expect(formatDmy("nada")).toBe("");
  });

  it("exporta la tabla de asesores en minutos", () => {
    const stats = (m: number) => ({ count: 1, mean: m, median: m, p90: m });
    const dual = { clock: stats(600), business: stats(300) };
    const csv = agentsCsv(
      [{ userId: "u1", name: "Luis", attended: 4, firstResponse: dual, reply: dual, resolution: dual, won: 2, lost: 1, resolved: 0, closeRatePct: 67, compliancePct: 80 }],
      "business",
    );
    expect(csv.split("\r\n")[1]).toBe("Luis;4;5;5;5;2;1;0;67;80");
  });
});

describe("computeMetrics", () => {
  function input(over: Partial<MetricsInput> = {}): MetricsInput {
    return {
      now: NOW,
      cases: [],
      activity: [],
      stages,
      caseTypes: types,
      reasons: [{ id: "r1", name: "Precio", kind: "lost" }],
      members: [
        { userId: "u1", name: "Luis" },
        { userId: "u2", name: "Ana" },
      ],
      teams: [],
      inbound: [],
      platformByContact: new Map([["k1", "whatsapp"], ["k2", "instagram"]]),
      scheduleFor: noSchedule,
      staleStageDays: 7,
      ...over,
    };
  }

  const cases = [
    mkCase({ id: "c1", status: "won", closed_at: iso(T0 + 5 * H), assignee_id: "u1", contact_id: "k1" }),
    mkCase({ id: "c2", status: "lost", closed_at: iso(T0 + 3 * H), assignee_id: "u2", contact_id: "k2", outcome_reason_id: "r1" }),
    mkCase({ id: "c3", case_type_id: "t2", origin: "proactive", status: "won", closed_at: iso(T0 + 8 * H), assignee_id: "u2", contact_id: "k2" }),
  ];
  const activity = [
    act({ case_id: "c1", type: "first_response", actor_id: "u1", created_at: iso(T0 + 300_000), meta: { seconds: 300, business_seconds: 300, waiting_since: iso(T0) } }),
    act({ case_id: "c2", type: "first_response", actor_id: "u2", created_at: iso(T0 + 1_200_000), meta: { seconds: 1200, business_seconds: 1200, waiting_since: iso(T0) } }),
  ];

  it("resume, agrupa por asesor y calcula resultados", () => {
    const r = computeMetrics(input({ cases, activity }), { period: "30d" });
    expect(r.summary.newCases).toBe(3);
    expect([r.summary.won, r.summary.lost, r.summary.resolved]).toEqual([2, 1, 0]);
    expect(r.summary.firstResponse.business.median).toBe(750);
    expect(r.summary.compliance.firstResponse).toEqual({ within: 1, total: 2, pct: 50 });
    expect(r.results.closeRatePct).toBe(67);
    expect(r.results.reasons.find((x) => x.name === "Precio")?.count).toBe(1);
    expect(r.results.proactive).toEqual([
      { typeId: "t2", typeName: "Renovación", activated: 1, won: 1, lost: 0, ratePct: 100 },
    ]);
    const ana = r.agents.find((a) => a.name === "Ana");
    expect(ana).toMatchObject({ attended: 2, won: 1, lost: 1, closeRatePct: 50, compliancePct: 0 });
    expect(r.agents.find((a) => a.name === "Luis")).toMatchObject({ attended: 1, compliancePct: 100 });
    expect(r.hasSchedule).toBe(false);
  });

  it("aplica los cortes de canal, asesor y origen", () => {
    expect(computeMetrics(input({ cases, activity }), { period: "30d", channel: "instagram" }).summary.newCases).toBe(2);
    expect(computeMetrics(input({ cases, activity }), { period: "30d", assigneeId: "u1" }).summary.newCases).toBe(1);
    expect(computeMetrics(input({ cases, activity }), { period: "30d", origin: "proactive" }).summary.newCases).toBe(1);
  });

  it("sin datos devuelve ceros y nulos, sin fallar", () => {
    const r = computeMetrics(input(), { period: "7d" });
    expect(r.summary.firstResponse.business.median).toBeNull();
    expect(r.summary.newCases).toBe(0);
    expect(r.agents).toEqual([]);
    expect(r.funnel).toEqual([]);
    expect(r.volume.daily).toHaveLength(7);
  });

  it("los mensajes entrantes se cortan por canal", () => {
    const inbound = [
      { created_at: iso(T0), platform: "whatsapp" },
      { created_at: iso(T0), platform: "instagram" },
    ];
    expect(computeMetrics(input({ inbound }), { period: "30d" }).volume.totalMessages).toBe(2);
    expect(computeMetrics(input({ inbound }), { period: "30d", channel: "instagram" }).volume.totalMessages).toBe(1);
  });
});
