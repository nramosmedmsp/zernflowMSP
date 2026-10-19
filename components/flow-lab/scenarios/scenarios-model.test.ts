import { describe, expect, it } from "vitest";
import type { ScenarioResult } from "@/lib/flow-lab/scenarios/types";
import { copyName, defaultCheck, fieldsFor, isIncomplete, resultSummary, statusOf, totalsText } from "./scenarios-model";
import { EXPECTATION_KINDS } from "@/lib/flow-lab/scenarios/types";

const result = (over: Partial<ScenarioResult> = {}): ScenarioResult => ({ ok: true, ranAt: "2026-10-19T15:00:00.000Z", total: 3, passed: 3, failed: 0, stepError: null, expectations: [], ...over });

describe("estado y resumen", () => {
  it("verde, rojo o sin correr", () => {
    expect(statusOf(null)).toBe("never");
    expect(statusOf(result())).toBe("passed");
    expect(statusOf(result({ ok: false, passed: 2, failed: 1 }))).toBe("failed");
  });

  it("resume cuántas expectativas se cumplieron o dónde se detuvo", () => {
    expect(resultSummary(null)).toBe("Sin correr");
    expect(resultSummary(result({ ok: false, passed: 2, failed: 1 }))).toBe("2 de 3 cumplidas");
    expect(resultSummary(result({ total: 0, passed: 0 }))).toBe("Sin expectativas");
    expect(resultSummary(result({ ok: false, stepError: { step: 2, text: "x", message: "y" } }))).toBe("Se detuvo en el paso 2");
    expect(resultSummary(result({ ok: false, stepError: { step: 0, text: "x", message: "y" } }))).toBe("No pudo arrancar");
  });

  it("totales de «Probar todos»", () => {
    expect(totalsText(["passed", "passed", "failed", "never"])).toBe("2 pasaron, 1 falló, 1 sin correr");
    expect(totalsText(["passed"])).toBe("1 pasó");
    expect(totalsText([])).toBe("Sin escenarios");
  });
});

describe("duplicar", () => {
  it("busca un nombre libre para la copia", () => {
    expect(copyName("Pregunta el precio", ["Pregunta el precio"])).toBe("Pregunta el precio (copia)");
    expect(copyName("Pregunta el precio", ["Pregunta el precio", "pregunta el precio (copia)"])).toBe("Pregunta el precio (copia 2)");
    expect(copyName("Pregunta el precio (copia)", ["Pregunta el precio", "Pregunta el precio (copia)"])).toBe("Pregunta el precio (copia 2)");
  });
});

describe("editor de expectativas", () => {
  it("cada tipo tiene valores iniciales y campos propios", () => {
    for (const kind of EXPECTATION_KINDS) {
      expect(defaultCheck(kind).kind).toBe(kind);
      expect(Array.isArray(fieldsFor(kind))).toBe(true);
    }
  });

  it("no deja guardar una expectativa con datos obligatorios vacíos", () => {
    expect(isIncomplete(defaultCheck("flow_activated"))).toBe(true);
    expect(isIncomplete({ kind: "flow_activated", flow: "Darse de baja" })).toBe(false);
    expect(isIncomplete(defaultCheck("nothing_sent"))).toBe(false);
    expect(isIncomplete(defaultCheck("template_sent"))).toBe(false); // el nombre es opcional
    expect(isIncomplete({ kind: "scheduled_case", caseType: "Recompra", inDays: NaN })).toBe(true);
    expect(isIncomplete({ kind: "scheduled_case", caseType: "Recompra", inDays: 0 })).toBe(false);
    expect(isIncomplete(defaultCheck("bot_paused"))).toBe(false);
  });
});
