import { describe, expect, it } from "vitest";
import { addDays, isDateString, limaDateOf, limaDateTimeIso, parseScheduleAt, scheduleInstant } from "./dates";
import {
  botOutboundPatch,
  humanOutboundPatch,
  inboundPatch,
  needsKeyDate,
  parseRule,
  planRules,
  shouldReopen,
  validateClose,
  type CloseValidationInput,
  type ParsedRule,
  type RuleEventContext,
  type RuleRow,
} from "./rules";

// 18 oct 2026, 14:35 en Lima.
const NOW = new Date("2026-10-18T19:35:00Z");

const PROSPECTO = "ct-prospecto";
const CLIENTE = "ct-cliente";
const FRECUENTE = "ct-frecuente";
const SOCIO = "ct-socio";
const EX_SOCIO = "ct-ex";
const RECOMPRA = "type-recompra";
const RENOVACION = "type-renovacion";

function rule(row: Partial<RuleRow> & Pick<RuleRow, "id" | "action" | "params">): ParsedRule {
  const parsed = parseRule({
    position: 0,
    enabled: true,
    trigger: "on_won",
    trigger_stage_id: null,
    condition: {},
    ...row,
  });
  if (!parsed) throw new Error("regla inválida");
  return parsed;
}

// Reglas de la plantilla E-commerce para Venta (y Recompra).
const ventaRules: ParsedRule[] = [
  rule({ id: "r1", position: 0, action: "set_contact_type", params: { contact_type_id: CLIENTE } }),
  rule({ id: "r2", position: 1, action: "set_contact_type", params: { contact_type_id: FRECUENTE, from_nth_win: 2 } }),
  rule({ id: "r3", position: 2, action: "schedule_case", params: { case_type_id: RECOMPRA, days_after: 25 } }),
];

// Reglas de la plantilla Gimnasio para Venta de membresía.
const membresiaRules: ParsedRule[] = [
  rule({ id: "g1", position: 0, action: "set_contact_type", params: { contact_type_id: SOCIO } }),
  rule({ id: "g2", position: 1, action: "ask_key_date", params: { label: "Vencimiento de membresía" } }),
  rule({ id: "g3", position: 2, action: "schedule_case", params: { case_type_id: RENOVACION, days_before_key_date: 7 } }),
];

const renovacionRules: ParsedRule[] = [
  rule({ id: "n1", position: 0, action: "ask_key_date", params: { label: "Vencimiento de membresía" } }),
  rule({ id: "n2", position: 1, action: "schedule_case", params: { case_type_id: RENOVACION, days_before_key_date: 7 } }),
  rule({ id: "n3", position: 2, trigger: "on_lost", action: "set_contact_type", params: { contact_type_id: EX_SOCIO } }),
];

function won(contactTypeId: string | null, extra: Partial<RuleEventContext> = {}): RuleEventContext {
  return { trigger: "on_won", stageId: "stage-won", categoryId: null, outcomeReasonId: null, contactTypeId, ...extra };
}

describe("fechas en hora de Lima", () => {
  it("día calendario de Lima, no de UTC", () => {
    expect(limaDateOf(new Date("2026-10-18T04:30:00Z"))).toBe("2026-10-17");
    expect(limaDateOf(NOW)).toBe("2026-10-18");
  });

  it("09:00 de Lima son las 14:00 UTC", () => {
    expect(limaDateTimeIso("2026-11-12")).toBe("2026-11-12T14:00:00.000Z");
  });

  it("suma días cruzando meses y años", () => {
    expect(addDays("2026-10-18", 25)).toBe("2026-11-12");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2026-03-05", -7)).toBe("2026-02-26");
  });

  it("si la fecha ya pasó, se programa para ahora", () => {
    expect(scheduleInstant("2026-10-01", NOW)).toBe(NOW.toISOString());
  });

  it("valida fechas reales", () => {
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("18/10/2026")).toBe(false);
    expect(parseScheduleAt("mañana", NOW)).toBeNull();
    expect(parseScheduleAt("2026-12-01", NOW)).toBe("2026-12-01T14:00:00.000Z");
  });
});

describe("reglas al cerrar: tipo de contacto", () => {
  it("la primera Venta ganada pasa a Cliente", () => {
    const plan = planRules({ rules: ventaRules, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: null });
    expect(plan.contactTypeId).toBe(CLIENTE);
  });

  it("Cliente frecuente desde la segunda ganada", () => {
    const plan = planRules({ rules: ventaRules, ctx: won(CLIENTE), wonCount: 2, now: NOW, keyDate: null });
    expect(plan.contactTypeId).toBe(FRECUENTE);
  });

  it("a partir de la tercera ya es Cliente frecuente: no hay cambio", () => {
    const plan = planRules({ rules: ventaRules, ctx: won(FRECUENTE), wonCount: 3, now: NOW, keyDate: null });
    expect(plan.contactTypeId).toBeUndefined();
  });

  it("las reglas de ganar no corren al perder", () => {
    const plan = planRules({
      rules: ventaRules,
      ctx: won(PROSPECTO, { trigger: "on_lost" }),
      wonCount: 0,
      now: NOW,
      keyDate: null,
    });
    expect(plan.matchedRuleIds).toEqual([]);
    expect(plan.schedules).toEqual([]);
  });

  it("respeta la condición (categoría, motivo, tipo de contacto)", () => {
    const conditional = [
      rule({
        id: "c1",
        action: "set_contact_type",
        condition: { outcome_reason_id: "reason-x", contact_type_id: PROSPECTO },
        params: { contact_type_id: CLIENTE },
      }),
    ];
    expect(planRules({ rules: conditional, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: null }).contactTypeId).toBeUndefined();
    expect(
      planRules({
        rules: conditional,
        ctx: won(PROSPECTO, { outcomeReasonId: "reason-x" }),
        wonCount: 1,
        now: NOW,
        keyDate: null,
      }).contactTypeId,
    ).toBe(CLIENTE);
  });

  it("Renovación perdida pasa a Ex socio", () => {
    const plan = planRules({
      rules: renovacionRules,
      ctx: won(SOCIO, { trigger: "on_lost" }),
      wonCount: 1,
      now: NOW,
      keyDate: "2026-11-30",
    });
    expect(plan.contactTypeId).toBe(EX_SOCIO);
    expect(plan.schedules).toEqual([]);
  });
});

describe("reglas al cerrar: gestiones programadas", () => {
  it("Recompra a 25 días, a las 09:00 de Lima", () => {
    const plan = planRules({ rules: ventaRules, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: null });
    expect(plan.schedules).toEqual([
      {
        ruleId: "r3",
        caseTypeId: RECOMPRA,
        scheduledFor: "2026-11-12T14:00:00.000Z",
        basis: "days_after",
        days: 25,
        missingKeyDate: false,
      },
    ]);
  });

  it("el asesor puede cambiar la fecha (overrides.schedule_at)", () => {
    const plan = planRules({
      rules: ventaRules,
      ctx: won(PROSPECTO),
      wonCount: 1,
      now: NOW,
      keyDate: null,
      overrides: { scheduleAt: "2026-12-20" },
    });
    expect(plan.schedules[0]).toMatchObject({ scheduledFor: "2026-12-20T14:00:00.000Z", basis: "override" });
  });

  it("o no programar nada esta vez", () => {
    const plan = planRules({
      rules: ventaRules,
      ctx: won(PROSPECTO),
      wonCount: 1,
      now: NOW,
      keyDate: null,
      overrides: { skipSchedule: true },
    });
    expect(plan.schedules).toEqual([]);
    expect(plan.contactTypeId).toBe(CLIENTE);
  });

  it("Renovación 7 días antes de la fecha clave", () => {
    const plan = planRules({ rules: membresiaRules, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: "2026-11-30" });
    expect(plan.contactTypeId).toBe(SOCIO);
    expect(plan.askKeyDate).toEqual({ ruleId: "g2", label: "Vencimiento de membresía" });
    expect(plan.schedules).toEqual([
      {
        ruleId: "g3",
        caseTypeId: RENOVACION,
        scheduledFor: "2026-11-23T14:00:00.000Z",
        basis: "days_before_key_date",
        days: 7,
        missingKeyDate: false,
      },
    ]);
  });

  it("sin fecha clave no se programa la Renovación (y se informa)", () => {
    const plan = planRules({ rules: membresiaRules, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: null });
    expect(plan.schedules[0]).toMatchObject({ scheduledFor: null, missingKeyDate: true });
  });

  it("si faltan menos de 7 días, la Renovación se activa ya", () => {
    const plan = planRules({ rules: membresiaRules, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: "2026-10-20" });
    expect(plan.schedules[0].scheduledFor).toBe(NOW.toISOString());
  });

  it("needsKeyDate detecta la regla que pide la fecha", () => {
    expect(needsKeyDate(membresiaRules, won(PROSPECTO))).toEqual({ label: "Vencimiento de membresía" });
    expect(needsKeyDate(ventaRules, won(PROSPECTO))).toBeNull();
    expect(needsKeyDate(membresiaRules, won(PROSPECTO, { trigger: "on_lost" }))).toBeNull();
  });

  it("parseRule descarta reglas apagadas o sin parámetros", () => {
    const base = { id: "x", position: 0, trigger: "on_won" as const, trigger_stage_id: null, condition: {} };
    expect(parseRule({ ...base, enabled: false, action: "set_contact_type", params: { contact_type_id: CLIENTE } })).toBeNull();
    expect(parseRule({ ...base, enabled: true, action: "schedule_case", params: {} })).toBeNull();
    expect(parseRule({ ...base, enabled: true, action: "schedule_case", params: { case_type_id: RECOMPRA, days_after: "30" } })).toMatchObject({
      params: { case_type_id: RECOMPRA, days_after: 30 },
    });
  });

  it("on_stage solo con la etapa indicada", () => {
    const r = rule({
      id: "s1",
      trigger: "on_stage",
      trigger_stage_id: "stage-pago",
      action: "set_contact_type",
      params: { contact_type_id: CLIENTE },
    });
    const ctx = (stageId: string): RuleEventContext => ({ ...won(PROSPECTO), trigger: "on_stage", stageId });
    expect(planRules({ rules: [r], ctx: ctx("otra"), wonCount: 0, now: NOW, keyDate: null }).matchedRuleIds).toEqual([]);
    expect(planRules({ rules: [r], ctx: ctx("stage-pago"), wonCount: 0, now: NOW, keyDate: null }).matchedRuleIds).toEqual([
      "s1",
    ]);
  });
});

describe("validación del cierre", () => {
  const base: CloseValidationInput = {
    caseType: { require_category: false, require_outcome_reason: true },
    stages: [
      { id: "s-open", name: "Asesorando", kind: "open", position: 0, archived_at: null },
      { id: "s-won", name: "Pagado", kind: "won", position: 1, archived_at: null },
      { id: "s-lost", name: "No compró", kind: "lost", position: 2, archived_at: null },
    ],
    reasons: [{ id: "precio", name: "Precio", kind: "lost", archived_at: null }],
    categories: [{ id: "cat", archived_at: null }],
    currentCategoryId: null,
    request: {},
  };

  it("ganar sin motivo: el tipo exige motivo, pero no hay motivos de ganada", () => {
    expect(validateClose({ ...base, request: { kind: "won" } })).toEqual({
      ok: true,
      kind: "won",
      stageId: "s-won",
      outcomeReasonId: null,
      categoryId: null,
    });
  });

  it("perder exige el motivo", () => {
    expect(validateClose({ ...base, request: { kind: "lost" } })).toEqual({ ok: false, error: "Elige el motivo del resultado." });
    expect(validateClose({ ...base, request: { stageId: "s-lost", outcomeReasonId: "precio" } })).toMatchObject({
      ok: true,
      kind: "lost",
    });
  });

  it("el motivo tiene que ser de la misma clase", () => {
    expect(validateClose({ ...base, request: { kind: "won", outcomeReasonId: "precio" } })).toMatchObject({ ok: false });
  });

  it("no se cierra con una etapa abierta ni de otro tipo", () => {
    expect(validateClose({ ...base, request: { stageId: "s-open" } })).toMatchObject({ ok: false });
    expect(validateClose({ ...base, request: { stageId: "ajena" } })).toMatchObject({ ok: false });
  });

  it("exige categoría si el tipo la pide", () => {
    const input = { ...base, caseType: { require_category: true, require_outcome_reason: false } };
    expect(validateClose({ ...input, request: { kind: "won" } })).toEqual({ ok: false, error: "Elige una categoría antes de cerrar." });
    expect(validateClose({ ...input, request: { kind: "won", categoryId: "cat" } })).toMatchObject({ ok: true, categoryId: "cat" });
    expect(validateClose({ ...input, currentCategoryId: "cat", request: { kind: "won" } })).toMatchObject({ ok: true });
  });

  it("sin clasificar solo se resuelve", () => {
    const input = { ...base, caseType: null, stages: [], reasons: [], categories: [] };
    expect(validateClose({ ...input, request: {} })).toMatchObject({ ok: true, kind: "resolved", stageId: null });
    expect(validateClose({ ...input, request: { kind: "won" } })).toMatchObject({ ok: false });
  });

  it("un tipo sin etapa de esa clase no se puede cerrar así", () => {
    expect(validateClose({ ...base, request: { kind: "resolved" } })).toMatchObject({ ok: false });
  });
});

describe("reapertura dentro de 24 h", () => {
  const at = "2026-10-18T20:00:00.000Z";

  it("se reabre si se cerró hace menos de 24 h", () => {
    expect(shouldReopen({ status: "resolved", closed_at: "2026-10-18T08:00:00.000Z" }, at)).toBe(true);
    expect(shouldReopen({ status: "won", closed_at: "2026-10-17T20:00:01.000Z" }, at)).toBe(true);
  });

  it("no se reabre pasadas 24 h", () => {
    expect(shouldReopen({ status: "lost", closed_at: "2026-10-17T20:00:00.000Z" }, at)).toBe(false);
    expect(shouldReopen({ status: "lost", closed_at: "2026-10-10T08:00:00.000Z" }, at)).toBe(false);
  });

  it("las canceladas, abiertas o sin fecha de cierre no se reabren", () => {
    expect(shouldReopen({ status: "cancelled", closed_at: "2026-10-18T19:00:00.000Z" }, at)).toBe(false);
    expect(shouldReopen({ status: "open", closed_at: null }, at)).toBe(false);
    expect(shouldReopen({ status: "won", closed_at: null }, at)).toBe(false);
  });
});

describe("primera respuesta: solo humana", () => {
  const inbound = "2026-10-18T15:00:00.000Z";
  const bot = "2026-10-18T15:00:05.000Z";
  const human = "2026-10-18T15:10:00.000Z";

  it("la entrada abre la espera solo si no había", () => {
    expect(inboundPatch({ waiting_since: null }, inbound)).toEqual({ last_inbound_at: inbound, waiting_since: inbound });
    expect(inboundPatch({ waiting_since: inbound }, human)).toEqual({ last_inbound_at: human, waiting_since: inbound });
  });

  it("el bot solo sella la salida: no corta la espera ni cuenta como respuesta", () => {
    expect(botOutboundPatch(bot)).toEqual({ last_outbound_at: bot });
  });

  it("la primera respuesta humana fija first_response_at con la duración desde la espera", () => {
    const state = { waiting_since: inbound, first_response_at: null };
    const afterBot = { ...state, ...botOutboundPatch(bot) };
    const { patch, firstResponseSeconds } = humanOutboundPatch(afterBot, human);
    expect(patch).toEqual({ last_outbound_at: human, waiting_since: null, first_response_at: human });
    expect(firstResponseSeconds).toBe(600);
  });

  it("las siguientes respuestas no cambian first_response_at", () => {
    const { patch, firstResponseSeconds } = humanOutboundPatch(
      { waiting_since: "2026-10-18T16:00:00.000Z", first_response_at: human },
      "2026-10-18T16:05:00.000Z",
    );
    expect(patch.first_response_at).toBeUndefined();
    expect(firstResponseSeconds).toBeNull();
  });

  it("sin espera (gestión proactiva sin mensaje del cliente) no hay primera respuesta", () => {
    const { patch, firstResponseSeconds } = humanOutboundPatch({ waiting_since: null, first_response_at: null }, human);
    expect(patch.first_response_at).toBeUndefined();
    expect(firstResponseSeconds).toBeNull();
  });
});

describe("R2-15: gana la regla más específica", () => {
  it("«desde la 2.ª» gana a «Cliente» aunque esté escrita antes", () => {
    const reversed = [
      rule({ id: "a", position: 0, action: "set_contact_type", params: { contact_type_id: FRECUENTE, from_nth_win: 2 } }),
      rule({ id: "b", position: 1, action: "set_contact_type", params: { contact_type_id: CLIENTE } }),
    ];
    expect(planRules({ rules: reversed, ctx: won(PROSPECTO), wonCount: 2, now: NOW, keyDate: null }).contactTypeId).toBe(FRECUENTE);
    // Con una sola ganada la regla de la 2.ª no aplica: queda Cliente.
    expect(planRules({ rules: reversed, ctx: won(PROSPECTO), wonCount: 1, now: NOW, keyDate: null }).contactTypeId).toBe(CLIENTE);
  });

  it("gana la de mayor N; a igual N, la que está más abajo", () => {
    const rules = [
      rule({ id: "a", position: 0, action: "set_contact_type", params: { contact_type_id: SOCIO, from_nth_win: 3 } }),
      rule({ id: "b", position: 1, action: "set_contact_type", params: { contact_type_id: FRECUENTE, from_nth_win: 2 } }),
      rule({ id: "c", position: 2, action: "set_contact_type", params: { contact_type_id: CLIENTE } }),
      rule({ id: "d", position: 3, action: "set_contact_type", params: { contact_type_id: EX_SOCIO } }),
    ];
    expect(planRules({ rules, ctx: won(null), wonCount: 3, now: NOW, keyDate: null }).contactTypeId).toBe(SOCIO);
    expect(planRules({ rules, ctx: won(null), wonCount: 2, now: NOW, keyDate: null }).contactTypeId).toBe(FRECUENTE);
    // Sin N (cuenta como 1) empatan Cliente y Ex socio: la última por posición.
    expect(planRules({ rules, ctx: won(null), wonCount: 1, now: NOW, keyDate: null }).contactTypeId).toBe(EX_SOCIO);
  });
});
