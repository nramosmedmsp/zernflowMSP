import { describe, expect, it } from "vitest";
import {
  MAX_CASE_FLOW_CHAIN,
  canRunInChain,
  extendFlowChain,
  matchesCaseEvent,
  parseFlowChain,
  selectCaseTriggers,
  serializeFlowChain,
  triggerMinutes,
  DEFAULT_NO_REPLY_MINUTES,
  type CaseEventLike,
} from "./case-trigger-match";
import {
  evaluateCaseCondition,
  isBooleanCaseField,
  isCaseConditionField,
  type CaseConditionSnapshot,
} from "./case-conditions";
import { decideSendMode, isWindowOpen, parseNodeTemplate, WHATSAPP_WINDOW_MS } from "./send-mode";
import { buildDesiredTriggers } from "../flow-triggers";

const stageEvent: CaseEventLike = { type: "case_stage_changed", caseTypeId: "t1", stageId: "s2" };
const closedEvent: CaseEventLike = { type: "case_closed", caseTypeId: "t1", stageId: "s9", outcome: "won" };

describe("matchesCaseEvent: cambio de etapa", () => {
  it("sin configuración coincide con cualquier cambio de etapa", () => {
    expect(matchesCaseEvent({ type: "case_stage_changed", config: {} }, stageEvent)).toBe(true);
    expect(matchesCaseEvent({ type: "case_stage_changed", config: null }, stageEvent)).toBe(true);
  });

  it("filtra por tipo de gestión y por etapa", () => {
    const trigger = (config: object) => ({ type: "case_stage_changed", config });
    expect(matchesCaseEvent(trigger({ case_type_id: "t1" }), stageEvent)).toBe(true);
    expect(matchesCaseEvent(trigger({ case_type_id: "otro" }), stageEvent)).toBe(false);
    expect(matchesCaseEvent(trigger({ stage_id: "s2" }), stageEvent)).toBe(true);
    expect(matchesCaseEvent(trigger({ stage_id: "s3" }), stageEvent)).toBe(false);
    expect(matchesCaseEvent(trigger({ case_type_id: "t1", stage_id: "s3" }), stageEvent)).toBe(false);
  });

  it("un tipo configurado no coincide con una gestión sin clasificar", () => {
    expect(
      matchesCaseEvent(
        { type: "case_stage_changed", config: { case_type_id: "t1" } },
        { ...stageEvent, caseTypeId: null },
      ),
    ).toBe(false);
  });

  it("ignora valores vacíos y no mezcla tipos de evento", () => {
    expect(matchesCaseEvent({ type: "case_stage_changed", config: { stage_id: "", case_type_id: " " } }, stageEvent)).toBe(
      true,
    );
    expect(matchesCaseEvent({ type: "case_closed", config: {} }, stageEvent)).toBe(false);
  });
});

describe("matchesCaseEvent: gestión cerrada", () => {
  it("filtra por tipo y por resultado", () => {
    const trigger = (config: object) => ({ type: "case_closed", config });
    expect(matchesCaseEvent(trigger({}), closedEvent)).toBe(true);
    expect(matchesCaseEvent(trigger({ outcome: "won" }), closedEvent)).toBe(true);
    expect(matchesCaseEvent(trigger({ outcome: "lost" }), closedEvent)).toBe(false);
    expect(matchesCaseEvent(trigger({ case_type_id: "t1", outcome: "won" }), closedEvent)).toBe(true);
    expect(matchesCaseEvent(trigger({ case_type_id: "t2", outcome: "won" }), closedEvent)).toBe(false);
  });
});

describe("matchesCaseEvent: cliente sin responder", () => {
  const event: CaseEventLike = { type: "client_no_reply", caseTypeId: "t1", stageId: "s1" };
  const trigger = (config: object) => ({ type: "client_no_reply", config });

  it("solo coincide el disparador con los mismos minutos que selló el cron", () => {
    expect(matchesCaseEvent(trigger({ minutes: 30 }), event, 30)).toBe(true);
    expect(matchesCaseEvent(trigger({ minutes: 60 }), event, 30)).toBe(false);
    expect(matchesCaseEvent(trigger({ minutes: "30" }), event, 30)).toBe(true);
  });

  it("sin minutes usa el valor por defecto", () => {
    expect(triggerMinutes({})).toBe(DEFAULT_NO_REPLY_MINUTES);
    expect(matchesCaseEvent(trigger({}), event, DEFAULT_NO_REPLY_MINUTES)).toBe(true);
    expect(matchesCaseEvent(trigger({ minutes: -5 }), event, DEFAULT_NO_REPLY_MINUTES)).toBe(true);
    expect(matchesCaseEvent(trigger({}), event, 30)).toBe(false);
  });

  it("sin sello en la gestión no se ejecuta ninguno", () => {
    expect(matchesCaseEvent(trigger({ minutes: 30 }), event, null)).toBe(false);
    expect(matchesCaseEvent(trigger({ minutes: 30 }), event)).toBe(false);
  });

  it("puede limitarse a un tipo de gestión", () => {
    expect(matchesCaseEvent(trigger({ minutes: 30, case_type_id: "t2" }), event, 30)).toBe(false);
    expect(matchesCaseEvent(trigger({ minutes: 30, case_type_id: "t1" }), event, 30)).toBe(true);
  });
});

describe("selectCaseTriggers", () => {
  const triggers = [
    { id: "a1", flow_id: "A", type: "case_stage_changed", config: { stage_id: "s2" } },
    { id: "a2", flow_id: "A", type: "case_stage_changed", config: {} },
    { id: "b1", flow_id: "B", type: "case_stage_changed", config: { stage_id: "s3" } },
    { id: "c1", flow_id: "C", type: "case_stage_changed", config: {} },
  ];

  it("elige los que coinciden y deja un disparador por flujo", () => {
    expect(selectCaseTriggers(triggers, stageEvent).map((t) => t.id)).toEqual(["a1", "c1"]);
  });

  it("excluye los flujos que ya corrieron en la cadena", () => {
    expect(selectCaseTriggers(triggers, { ...stageEvent, chain: ["A"] }).map((t) => t.id)).toEqual(["c1"]);
  });
});

describe("protección contra bucles", () => {
  it("un flujo no se vuelve a disparar a sí mismo", () => {
    expect(canRunInChain([], "A")).toBe(true);
    expect(canRunInChain(undefined, "A")).toBe(true);
    expect(canRunInChain(["A"], "A")).toBe(false);
    expect(canRunInChain(["A"], "B")).toBe(true);
  });

  it("A -> B -> A se corta en el segundo A", () => {
    let chain = extendFlowChain([], "A");
    expect(canRunInChain(chain, "B")).toBe(true);
    chain = extendFlowChain(chain, "B");
    expect(canRunInChain(chain, "A")).toBe(false);
  });

  it("la cadena tiene un largo máximo", () => {
    const full = Array.from({ length: MAX_CASE_FLOW_CHAIN }, (_, i) => `f${i}`);
    expect(canRunInChain(full, "otro")).toBe(false);
    expect(canRunInChain(full.slice(1), "otro")).toBe(true);
  });

  it("extender no repite ids y la cadena viaja como texto", () => {
    expect(extendFlowChain(["A"], "A")).toEqual(["A"]);
    expect(parseFlowChain(serializeFlowChain(["A", "B"]))).toEqual(["A", "B"]);
    expect(parseFlowChain(undefined)).toEqual([]);
    expect(parseFlowChain("")).toEqual([]);
  });

  it("un disparador de cambio de etapa no se repite en la cadena que provocó", () => {
    // Flujo F (disparado por cambio de etapa) cambia la etapa: el evento trae chain [F].
    const triggers = [{ flow_id: "F", type: "case_stage_changed", config: {} }];
    expect(selectCaseTriggers(triggers, { ...stageEvent, chain: ["F"] })).toEqual([]);
  });
});

describe("decideSendMode", () => {
  const base = { platform: "whatsapp", hasText: true, hasTemplate: true };

  it("ventana abierta y hay texto: envía texto", () => {
    expect(decideSendMode({ ...base, windowOpen: true })).toEqual({ mode: "text" });
    expect(decideSendMode({ ...base, windowOpen: true, hasTemplate: false })).toEqual({ mode: "text" });
  });

  it("ventana cerrada y hay plantilla: envía la plantilla", () => {
    expect(decideSendMode({ ...base, windowOpen: false })).toEqual({ mode: "template" });
    expect(decideSendMode({ ...base, windowOpen: false, hasText: false })).toEqual({ mode: "template" });
  });

  it("ventana cerrada y sin plantilla: no envía y da el motivo", () => {
    expect(decideSendMode({ ...base, windowOpen: false, hasTemplate: false })).toEqual({
      mode: "skip",
      reason: "window_closed",
    });
  });

  it("ventana abierta sin texto: plantilla si hay, si no nada que enviar", () => {
    expect(decideSendMode({ ...base, windowOpen: true, hasText: false })).toEqual({ mode: "template" });
    expect(decideSendMode({ ...base, windowOpen: true, hasText: false, hasTemplate: false })).toEqual({
      mode: "skip",
      reason: "no_content",
    });
  });

  it("fuera de WhatsApp solo hay texto, sin ventana ni plantillas", () => {
    expect(decideSendMode({ platform: "instagram", windowOpen: false, hasText: true, hasTemplate: true })).toEqual({
      mode: "text",
    });
    expect(decideSendMode({ platform: "instagram", windowOpen: true, hasText: false, hasTemplate: true })).toEqual({
      mode: "skip",
      reason: "no_content",
    });
  });
});

describe("isWindowOpen y parseNodeTemplate", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");

  it("la ventana dura 24 horas desde el último mensaje del cliente", () => {
    expect(isWindowOpen(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isWindowOpen(new Date(now - WHATSAPP_WINDOW_MS + 1000).toISOString(), now)).toBe(true);
    expect(isWindowOpen(new Date(now - WHATSAPP_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
  });

  it("sin mensaje del cliente la ventana está cerrada", () => {
    expect(isWindowOpen(null, now)).toBe(false);
    expect(isWindowOpen(undefined, now)).toBe(false);
    expect(isWindowOpen("no es una fecha", now)).toBe(false);
  });

  it("la plantilla necesita nombre e idioma", () => {
    expect(parseNodeTemplate(null)).toBeNull();
    expect(parseNodeTemplate({ template_name: "recordatorio" })).toBeNull();
    expect(parseNodeTemplate({ template_name: " recordatorio ", language: "es", params: ["{nombre}", 3] })).toEqual({
      template_name: "recordatorio",
      language: "es",
      params: ["{nombre}"],
    });
  });
});

describe("condiciones de gestión", () => {
  const snap: CaseConditionSnapshot = {
    contactTypeId: "ct1",
    caseTypeId: "t1",
    stageId: "s1",
    teamId: "team1",
    hasAssignee: false,
    withinHours: true,
  };
  const check = (field: Parameters<typeof evaluateCaseCondition>[0]["field"], operator: string, value: string, s = snap) =>
    evaluateCaseCondition({ field, operator, value }, s);

  it("reconoce los campos nuevos", () => {
    expect(isCaseConditionField("case_stage")).toBe(true);
    expect(isCaseConditionField("tag:vip")).toBe(false);
    expect(isBooleanCaseField("has_assignee")).toBe(true);
    expect(isBooleanCaseField("case_team")).toBe(false);
  });

  it("tipo de contacto, tipo de gestión, etapa y equipo comparan por id", () => {
    expect(check("contact_type", "equals", "ct1")).toBe(true);
    expect(check("contact_type", "not_equals", "ct1")).toBe(false);
    expect(check("case_type", "equals", "t1")).toBe(true);
    expect(check("case_type", "equals", "t2")).toBe(false);
    expect(check("case_stage", "equals", "s1")).toBe(true);
    expect(check("case_team", "equals", "team1")).toBe(true);
    expect(check("case_team", "not_equals", "team2")).toBe(true);
  });

  it("sin gestión (todo vacío) no coincide con ningún id", () => {
    const empty: CaseConditionSnapshot = {
      contactTypeId: null,
      caseTypeId: null,
      stageId: null,
      teamId: null,
      hasAssignee: false,
      withinHours: true,
    };
    expect(check("case_type", "equals", "t1", empty)).toBe(false);
    expect(check("case_type", "exists", "", empty)).toBe(false);
    expect(check("case_type", "exists", "", snap)).toBe(true);
  });

  it("tiene responsable y dentro de horario comparan con true o false", () => {
    expect(check("has_assignee", "equals", "false")).toBe(true);
    expect(check("has_assignee", "equals", "true")).toBe(false);
    expect(check("has_assignee", "equals", "true", { ...snap, hasAssignee: true })).toBe(true);
    expect(check("within_hours", "equals", "true")).toBe(true);
    expect(check("within_hours", "equals", "true", { ...snap, withinHours: false })).toBe(false);
    expect(check("within_hours", "equals", "false", { ...snap, withinHours: false })).toBe(true);
  });
});

describe("buildDesiredTriggers con disparadores de gestión", () => {
  const node = (data: Record<string, unknown>) => ({ id: "n1", type: "trigger", data });

  it("guarda tipo, etapa, resultado y minutos en config", () => {
    const rows = buildDesiredTriggers(
      [
        node({ triggerType: "case_stage_changed", caseTypeId: "t1", stageId: "s2", outcome: "won" }),
        node({ triggerType: "case_closed", caseTypeId: "t1", outcome: "lost", stageId: "ignorada" }),
        node({ triggerType: "client_no_reply", minutes: 45, outcome: "won" }),
      ],
      "flow-1",
    );
    expect(rows.map((r) => r.config)).toEqual([
      { case_type_id: "t1", stage_id: "s2" },
      { case_type_id: "t1", outcome: "lost" },
      { minutes: 45 },
    ]);
    expect(rows.every((r) => r.channel_id === null && r.is_active)).toBe(true);
  });

  it("sin configurar publica el disparador sin filtros", () => {
    const rows = buildDesiredTriggers([node({ triggerType: "case_closed" })], "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toEqual({});
  });
});
