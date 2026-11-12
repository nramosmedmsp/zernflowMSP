import { describe, expect, it } from "vitest";
import {
  STRICT_LOCK_MESSAGE,
  blockedMoveText,
  exitViews,
  layoutStepBar,
  moveConfirmation,
  requirementState,
  stepBarSteps,
  stepHeader,
  stepHint,
  type StepWidths,
} from "./step-bar-model";
import { caseGuide } from "./case-card-model";

const st = (
  id: string,
  name: string,
  kind: "open" | "won" | "lost" | "resolved" = "open",
  extra: Partial<{ nextSteps: { stageId: string | null; action: "remind_tomorrow" | null; label: string | null }[]; requires: "category" | "note" | "solution" | null }> = {},
) => ({ id, name, kind, archived: false, guideText: null, nextSteps: extra.nextSteps ?? [], requires: extra.requires ?? null });

// Venta con guía configurada como en la plantilla: Esperando pago → Pagó / recordar / No compró.
const venta = [
  st("s1", "Nuevo interesado", "open", { nextSteps: [{ stageId: "s2", action: null, label: "Ya sé qué busca" }] }),
  st("s2", "Asesorando"),
  st("s3", "Pedido o enlace de pago enviado"),
  st("s4", "Esperando pago", "open", {
    nextSteps: [
      { stageId: "w", action: null, label: "Pagó" },
      { stageId: null, action: "remind_tomorrow", label: "Aún no, recordarle mañana" },
      { stageId: "l", action: null, label: null },
    ],
  }),
  st("w", "Pagado", "won"),
  st("l", "No compró", "lost"),
];

const names = new Map(venta.map((s) => [s.id, s.name]));

describe("stepBarSteps", () => {
  it("numera los pasos abiertos y marca hechos, actual y siguientes con su distancia", () => {
    const steps = stepBarSteps(venta, "s3", { strictOrder: false, canSupervise: false });
    expect(steps.map((s) => [s.number, s.state, s.delta, s.locked])).toEqual([
      [1, "past", -2, false],
      [2, "past", -1, false],
      [3, "current", 0, false],
      [4, "next", 1, false],
    ]);
    expect(stepHeader(steps)).toBe("Paso 3 de 4");
  });

  it("orden estricto: el asesor ve candado en lo que no puede tocar (también en los hechos)", () => {
    // Desde «Esperando pago» solo se puede volver un paso (3); los pasos 1 y 2 quedan bloqueados pero siguen «hechos».
    const steps = stepBarSteps(venta, "s4", { strictOrder: true, canSupervise: false });
    expect(steps.map((s) => [s.id, s.state, s.locked])).toEqual([
      ["s1", "past", true],
      ["s2", "past", true],
      ["s3", "past", false],
      ["s4", "current", false],
    ]);
  });

  it("orden estricto: hacia adelante solo los pasos configurados", () => {
    const steps = stepBarSteps(venta, "s1", { strictOrder: true, canSupervise: false });
    expect(steps.map((s) => [s.id, s.locked])).toEqual([
      ["s1", false],
      ["s2", false],
      ["s3", true],
      ["s4", true],
    ]);
  });

  it("supervisor y administrador no tienen candados y sus saltos fuera de la guía se marcan", () => {
    const steps = stepBarSteps(venta, "s4", { strictOrder: true, canSupervise: true });
    expect(steps.some((s) => s.locked)).toBe(false);
    expect(steps.map((s) => [s.id, s.isJump])).toEqual([
      ["s1", true],
      ["s2", true],
      ["s3", false],
      ["s4", false],
    ]);
  });

  it("sin orden estricto no hay candados, y sin etapa actual tampoco", () => {
    expect(stepBarSteps(venta, "s4", { strictOrder: false, canSupervise: false }).some((s) => s.locked)).toBe(false);
    const none = stepBarSteps(venta, null, { strictOrder: true, canSupervise: false });
    expect(none.some((s) => s.locked)).toBe(false);
    expect(stepHeader(none)).toBeNull();
  });

  it("un tipo con una sola etapa abierta tiene un solo paso", () => {
    const steps = stepBarSteps([st("a", "Abierta"), st("r", "Resuelta", "resolved")], "a", { strictOrder: false, canSupervise: false });
    expect(steps).toHaveLength(1);
    expect(stepHeader(steps)).toBe("Paso 1 de 1");
  });
});

describe("stepHint", () => {
  it("dice qué se puede hacer según quién mira", () => {
    expect(stepHint({ canEdit: true, strictLocked: false, canSupervise: false, strictOrder: false })).toBe("Toca un paso para moverte");
    expect(stepHint({ canEdit: true, strictLocked: true, canSupervise: false, strictOrder: true })).toBe("Orden estricto");
    expect(stepHint({ canEdit: true, strictLocked: false, canSupervise: true, strictOrder: true })).toBe(
      "Supervisor: puedes saltar a cualquier paso",
    );
    expect(stepHint({ canEdit: false, strictLocked: false, canSupervise: false, strictOrder: false })).toContain("Solo quien tiene la gestión");
  });

  it("el candado se explica con el texto acordado", () => {
    expect(STRICT_LOCK_MESSAGE).toBe("Orden estricto: pídele a un supervisor");
  });
});

describe("layoutStepBar", () => {
  const w = (state: StepWidths["state"], name: number): StepWidths => ({ state, check: 28, number: 28, name });
  const steps = [w("past", 90), w("past", 80), w("current", 120), w("next", 110), w("next", 100), w("next", 90)];
  const gap = 6;
  const base = { steps, gap, foldWidth: 40 };

  it("con espacio de sobra: hechos como ✓ y todos los demás con nombre", () => {
    const l = layoutStepBar({ ...base, available: 1000 });
    expect(l.folded).toBe(false);
    expect(l.modes).toEqual(["check", "check", "name", "name", "name", "name"]);
  });

  it("al faltar espacio: el actual y el siguiente conservan el nombre; los lejanos quedan en número", () => {
    // ✓✓ (28+28) + actual 120 + siguiente 110 + 2 números (56) + 5 huecos (30) = 372 → lo mínimo.
    const tight = layoutStepBar({ ...base, available: 372 });
    expect(tight.folded).toBe(false);
    expect(tight.modes).toEqual(["check", "check", "name", "name", "number", "number"]);
    // Sobra para un nombre más (de 28 a 100 = +72).
    expect(layoutStepBar({ ...base, available: 372 + 72 }).modes).toEqual(["check", "check", "name", "name", "name", "number"]);
  });

  it("si aun así no cabe, los hechos se pliegan en «✓ N hechos»", () => {
    // Lo mínimo mide 372; plegado: 40 + 120 + 110 + 56 + 4 huecos (24) = 350.
    const l = layoutStepBar({ ...base, available: 360 });
    expect(l.folded).toBe(true);
    expect(l.modes.slice(2)).toEqual(["name", "name", "number", "number"]);
  });

  it("en un celular angosto (ni plegado cabe el nombre del siguiente) el siguiente pasa a número y el actual conserva su nombre", () => {
    const l = layoutStepBar({ ...base, available: 240 });
    expect(l.folded).toBe(true);
    expect(l.modes.slice(2)).toEqual(["name", "number", "number", "number"]);
  });

  it("no pliega si plegar no ahorra espacio", () => {
    const one = [w("past", 90), w("current", 120), w("next", 110)];
    const l = layoutStepBar({ steps: one, gap, foldWidth: 70, available: 100 });
    expect(l.folded).toBe(false);
  });

  it("sin paso actual todos son siguientes: el primero con nombre", () => {
    const l = layoutStepBar({ steps: [w("next", 100), w("next", 90), w("next", 80)], gap, foldWidth: 70, available: 200 });
    expect(l.modes[0]).toBe("name");
    expect(l.folded).toBe(false);
  });
});

describe("moveConfirmation", () => {
  const steps = stepBarSteps(venta, "s4", { strictOrder: false, canSupervise: false });
  it("hacia atrás: cuántos pasos vuelve", () => {
    expect(moveConfirmation(steps[1])).toEqual({ question: "¿Mover a Asesorando?", detail: "Vuelves 2 pasos" });
    expect(moveConfirmation(steps[2])).toEqual({ question: "¿Mover a Pedido o enlace de pago enviado?", detail: "Vuelves 1 paso" });
  });

  it("hacia adelante: cuántos pasos avanza", () => {
    const from1 = stepBarSteps(venta, "s1", { strictOrder: false, canSupervise: false });
    expect(moveConfirmation(from1[3]).detail).toBe("Avanzas 3 pasos");
    expect(moveConfirmation(from1[1]).detail).toBe("Avanzas 1 paso");
  });

  it("un salto de supervisor avisa que queda en el historial", () => {
    const sup = stepBarSteps(venta, "s4", { strictOrder: true, canSupervise: true });
    expect(moveConfirmation(sup[0])).toEqual({ question: "¿Mover a Nuevo interesado?", detail: "Vuelves 3 pasos · queda en el historial" });
  });
});

describe("requirementState", () => {
  const base = { hasCategory: false, hasCategories: true, noteDone: false, solutionDone: false, canSupervise: false };

  it("la categoría pendiente bloquea a un asesor y no a un supervisor", () => {
    const r = requirementState({ ...base, requires: "category" })!;
    expect(r).toMatchObject({ kind: "category", label: "Elige la categoría", done: false, blocking: true, hint: "primero elige la categoría" });
    expect(blockedMoveText("Esperando pago", r)).toBe("Antes de ir a Esperando pago: elige la categoría");
    expect(requirementState({ ...base, requires: "category", canSupervise: true })).toMatchObject({ done: false, blocking: false });
  });

  it("con la categoría elegida queda hecho y no bloquea", () => {
    expect(requirementState({ ...base, requires: "category", hasCategory: true })).toMatchObject({ done: true, blocking: false });
  });

  it("sin categorías en el tipo no pide nada", () => {
    expect(requirementState({ ...base, requires: "category", hasCategories: false })).toBeNull();
  });

  it("nota y solución", () => {
    expect(requirementState({ ...base, requires: "note" })).toMatchObject({ label: "Deja una nota", hint: "primero deja una nota", blocking: true });
    expect(requirementState({ ...base, requires: "note", noteDone: true })).toMatchObject({ done: true, blocking: false });
    expect(requirementState({ ...base, requires: "solution" })).toMatchObject({ label: "Registra la solución", blocking: true });
    expect(requirementState({ ...base, requires: "solution", solutionDone: true })).toMatchObject({ done: true });
  });

  it("sin requisito no hay nada", () => {
    expect(requirementState({ ...base, requires: null })).toBeNull();
  });
});

describe("exitViews (textos de los botones)", () => {
  const steps = stepBarSteps(venta, "s4", { strictOrder: false, canSupervise: false });

  it("Esperando pago: Pagó cierra como Pagado, el recordatorio no cambia el paso, No compró es discreto", () => {
    const views = exitViews(caseGuide({ stages: venta }, "s4").exits, steps, names);
    expect(views.map((v) => [v.kind, v.title, v.sub])).toEqual([
      ["primary", "Pagó", "cierra como Pagado"],
      ["help", "Aún no, recordarle mañana", "no cambia el paso"],
      ["danger", "No compró", null],
    ]);
  });

  it("con etiqueta: «pasa a Asesorando»; sin etiqueta: «Pasar a …» y «va al paso 2 de 4»", () => {
    const first = stepBarSteps(venta, "s1", { strictOrder: false, canSupervise: false });
    const [custom] = exitViews(caseGuide({ stages: venta }, "s1").exits, first, names);
    expect([custom.title, custom.sub]).toEqual(["Ya sé qué busca", "pasa a Asesorando"]);

    const [plain] = exitViews(caseGuide({ stages: venta }, "s2").exits, stepBarSteps(venta, "s2", { strictOrder: false, canSupervise: false }), names);
    expect([plain.kind, plain.title, plain.sub]).toEqual(["primary", "Pasar a Pedido o enlace de pago enviado", "va al paso 3 de 4"]);
  });

  it("sin etiqueta y hacia un paso anterior: «Volver a …»", () => {
    const guide = [
      st("a", "Nueva"),
      st("b", "En gestión", "open", { nextSteps: [{ stageId: "a", action: null, label: null }] }),
      st("r", "Resuelta", "resolved"),
    ];
    const [back] = exitViews(
      caseGuide({ stages: guide }, "b").exits,
      stepBarSteps(guide, "b", { strictOrder: false, canSupervise: false }),
      new Map(guide.map((s) => [s.id, s.name])),
    );
    expect([back.title, back.sub, back.back]).toEqual(["Volver a Nueva", "vuelve al paso 1 de 2", true]);
  });

  it("un cierre sin etiqueta dice «Cerrar como …»", () => {
    const last = [st("a", "Abierta"), st("r", "Resuelta", "resolved")];
    const [close] = exitViews(caseGuide({ stages: last }, "a").exits, stepBarSteps(last, "a", { strictOrder: false, canSupervise: false }), new Map(last.map((s) => [s.id, s.name])));
    expect([close.title, close.sub]).toEqual(["Cerrar como Resuelta", "cierra la gestión"]);
  });
});
