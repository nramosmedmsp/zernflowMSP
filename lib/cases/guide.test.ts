// Guía de la gestión (00037): pasos siguientes, orden estricto, validación de la
// configuración, consecuencias del cierre y que el relleno de la migración
// coincida con la plantilla de E-commerce.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TEMPLATES } from "@/lib/business-templates";
import {
  GUIDE_TEXT_MAX,
  STEP_LABEL_MAX,
  allowedTargetIds,
  checkRequirements,
  checkStrictOrder,
  cleanGuideText,
  closeConsequences,
  effectiveSteps,
  parseNextSteps,
  previousOpenStageId,
  resolveExits,
  serializeNextSteps,
  validateNextSteps,
  type GuideStage,
} from "./guide";

function stage(id: string, name: string, kind: GuideStage["kind"], extra: Partial<GuideStage> = {}): GuideStage {
  return { id, name, kind, archived: false, guideText: null, nextSteps: [], requires: null, ...extra };
}

const stages: GuideStage[] = [
  stage("a", "Nuevo", "open"),
  stage("b", "Asesorando", "open"),
  stage("c", "Esperando pago", "open"),
  stage("w", "Pagado", "won"),
  stage("l", "No compró", "lost"),
];

describe("pasos siguientes", () => {
  it("sin configurar: la siguiente etapa abierta y todos los cierres", () => {
    const exits = resolveExits(stages, "a");
    expect(exits.map((e) => [e.stageId, e.type, e.tone])).toEqual([
      ["b", "stage", "primary"],
      ["w", "close", "ghost"],
      ["l", "close", "danger"],
    ]);
  });

  it("en la última etapa abierta solo quedan los cierres", () => {
    expect(resolveExits(stages, "c").map((e) => e.stageId)).toEqual(["w", "l"]);
  });

  it("una etapa archivada no se ofrece", () => {
    const list = stages.map((s) => (s.id === "b" ? { ...s, archived: true } : s));
    expect(resolveExits(list, "a").map((e) => e.stageId)).toEqual(["c", "w", "l"]);
  });

  it("configurados: respeta el orden, las etiquetas y la ayuda de recordar", () => {
    const list = stages.map((s) =>
      s.id === "c"
        ? {
            ...s,
            nextSteps: [
              { stageId: "w", action: null, label: "Pagó" },
              { stageId: null, action: "remind_tomorrow" as const, label: "Aún no" },
              { stageId: "l", action: null, label: null },
            ],
          }
        : s,
    );
    const exits = resolveExits(list, "c");
    expect(exits.map((e) => [e.label, e.type, e.tone])).toEqual([
      ["Pagó", "close", "primary"],
      ["Aún no", "remind", "ghost"],
      ["No compró", "close", "danger"],
    ]);
  });

  it("ignora pasos configurados que apuntan a etapas que ya no existen y vuelve al predeterminado", () => {
    const list = stages.map((s) => (s.id === "a" ? { ...s, nextSteps: [{ stageId: "zzz", action: null, label: null }] } : s));
    expect(effectiveSteps(list, "a").map((s) => s.stageId)).toEqual(["b", "w", "l"]);
  });

  it("volver un paso: la abierta anterior", () => {
    expect(previousOpenStageId(stages, "a")).toBeNull();
    expect(previousOpenStageId(stages, "b")).toBe("a");
    expect(previousOpenStageId(stages, "w")).toBeNull();
  });

  it("lee y guarda next_steps sin perder nada válido", () => {
    const json = [{ stage_id: "x", label: "Hola" }, { action: "remind_tomorrow" }, { nada: 1 }, "raro", { action: "otra" }];
    const parsed = parseNextSteps(json);
    expect(parsed).toEqual([
      { stageId: "x", action: null, label: "Hola" },
      { stageId: null, action: "remind_tomorrow", label: null },
    ]);
    expect(serializeNextSteps(parsed)).toEqual([{ stage_id: "x", label: "Hola" }, { action: "remind_tomorrow" }]);
    expect(serializeNextSteps([])).toBeNull();
    expect(parseNextSteps(null)).toEqual([]);
  });
});

describe("orden estricto", () => {
  const configured = stages.map((s) =>
    s.id === "a" ? { ...s, nextSteps: [{ stageId: "b", action: null, label: null }] } : s,
  );

  it("con el orden apagado cualquiera va a cualquier etapa", () => {
    expect(checkStrictOrder({ strict: false, canSupervise: false, stages: configured, currentStageId: "a", targetStageId: "c" })).toBeNull();
  });

  it("un asesor solo va a los pasos configurados", () => {
    const base = { strict: true, canSupervise: false, stages: configured, currentStageId: "a" };
    expect(checkStrictOrder({ ...base, targetStageId: "b" })).toBeNull();
    expect(checkStrictOrder({ ...base, targetStageId: "c" })).toMatch(/Orden estricto: desde «Nuevo» solo puedes pasar a Asesorando/);
    expect(checkStrictOrder({ ...base, targetStageId: "w" })).toMatch(/Orden estricto/);
  });

  it("un asesor puede volver un paso", () => {
    expect(checkStrictOrder({ strict: true, canSupervise: false, stages: configured, currentStageId: "b", targetStageId: "a" })).toBeNull();
    expect(allowedTargetIds(configured, "b").has("a")).toBe(true);
  });

  it("un supervisor o administrador queda exento", () => {
    expect(checkStrictOrder({ strict: true, canSupervise: true, stages: configured, currentStageId: "a", targetStageId: "c" })).toBeNull();
  });

  it("sin etapa actual no hay recorrido que respetar", () => {
    expect(checkStrictOrder({ strict: true, canSupervise: false, stages: configured, currentStageId: null, targetStageId: "c" })).toBeNull();
  });
});

describe("la etapa pide categoría", () => {
  const list = stages.map((s) => (s.id === "a" ? { ...s, requires: "category" as const } : s));
  const base = { canSupervise: false, stages: list, currentStageId: "a", targetStageId: "b", categoryId: null, hasCategories: true };

  it("bloquea avanzar sin categoría", () => {
    expect(checkRequirements(base)).toMatch(/categoría/);
  });
  it("no bloquea con categoría, sin categorías configuradas, a supervisores ni al volver", () => {
    expect(checkRequirements({ ...base, categoryId: "cat" })).toBeNull();
    expect(checkRequirements({ ...base, hasCategories: false })).toBeNull();
    expect(checkRequirements({ ...base, canSupervise: true })).toBeNull();
    expect(checkRequirements({ ...base, currentStageId: "b", targetStageId: "a", stages: list.map((s) => (s.id === "b" ? { ...s, requires: "category" as const } : s)) })).toBeNull();
  });
});

describe("validación de la configuración", () => {
  const typeStages = [
    { id: "a", kind: "open" as const, archived: false },
    { id: "b", kind: "open" as const, archived: false },
    { id: "x", kind: "open" as const, archived: true },
    { id: "w", kind: "won" as const, archived: false },
  ];
  const ok = (steps: unknown) => validateNextSteps({ stageId: "a", steps, stages: typeStages });

  it("acepta etapas abiertas y finales del mismo tipo, y la ayuda", () => {
    expect(ok([{ stageId: "b", label: " Sigue " }, { stageId: "w" }, { action: "remind_tomorrow", label: "Luego" }])).toEqual({
      ok: true,
      steps: [
        { stageId: "b", action: null, label: "Sigue" },
        { stageId: "w", action: null, label: null },
        { stageId: null, action: "remind_tomorrow", label: "Luego" },
      ],
    });
  });
  it("rechaza etapas de otro tipo, archivadas, la misma etapa y repetidas", () => {
    expect(ok([{ stageId: "otro-tipo" }])).toHaveProperty("error");
    expect(ok([{ stageId: "x" }])).toHaveProperty("error");
    expect(ok([{ stageId: "a" }])).toEqual({ error: "Una etapa no puede llevar a sí misma." });
    expect(ok([{ stageId: "b" }, { stageId: "b" }])).toEqual({ error: "Un paso siguiente está repetido." });
  });
  it("limita el largo de las etiquetas y la cantidad de pasos", () => {
    expect(ok([{ stageId: "b", label: "x".repeat(STEP_LABEL_MAX + 1) }])).toHaveProperty("error");
    expect(ok([{ stageId: "b", label: "x".repeat(STEP_LABEL_MAX) }])).toHaveProperty("ok", true);
    expect(ok(Array.from({ length: 7 }, () => ({ stageId: "b" })))).toHaveProperty("error");
    expect(ok([{}])).toHaveProperty("error");
    expect(ok("no")).toHaveProperty("error");
    expect(ok(null)).toEqual({ ok: true, steps: [] });
  });
  it("el texto de la guía admite hasta 200 caracteres", () => {
    expect(cleanGuideText("  Saluda   y pregunta  ")).toBe("Saluda y pregunta");
    expect(cleanGuideText("   ")).toBeNull();
    expect(cleanGuideText(null)).toBeNull();
    expect(cleanGuideText("x".repeat(GUIDE_TEXT_MAX))).toHaveLength(GUIDE_TEXT_MAX);
    expect(cleanGuideText("x".repeat(GUIDE_TEXT_MAX + 1))).toHaveProperty("error");
    expect(cleanGuideText(5)).toHaveProperty("error");
  });
});

describe("consecuencias del cierre", () => {
  const base = {
    outcomeName: "Pagado",
    needsApproval: false,
    skipSchedule: false,
    contactTypeName: (id: string | null) => (id === "t1" ? "Cliente" : null),
    formatDate: (iso: string) => `el ${iso.slice(0, 10)}`,
    missing: [] as string[],
  };

  it("lista el resultado, el cambio de tipo de contacto y la gestión programada", () => {
    const lines = closeConsequences({
      ...base,
      preview: {
        contactType: { from: null, to: "t1" },
        schedules: [{ caseTypeName: "Recompra", scheduledFor: "2026-11-30T14:00:00.000Z" }],
        blocked: [],
        askKeyDate: null,
      },
    });
    expect(lines.map((l) => l.text)).toEqual([
      "Se cerrará como «Pagado»",
      "El contacto pasará a «Cliente»",
      "Se programará Recompra para el el 2026-11-30",
    ]);
    expect(lines.every((l) => l.tone === "ok")).toBe(true);
  });

  it("avisa lo que falta, la aprobación y los tipos archivados; no lista lo que se omite", () => {
    const lines = closeConsequences({
      ...base,
      outcomeName: "Sin solución",
      needsApproval: true,
      skipSchedule: true,
      missing: ["elegir el motivo"],
      preview: {
        contactType: null,
        schedules: [{ caseTypeName: "Recompra", scheduledFor: "2026-11-30T14:00:00.000Z" }],
        blocked: [{ caseTypeName: "Renovación" }],
        askKeyDate: null,
      },
    });
    expect(lines.map((l) => l.text)).toEqual([
      "Se pedirá a un supervisor cerrar como «Sin solución»; mientras tanto sigue abierta",
      "No se programará Renovación: ese tipo está archivado",
      "Falta: elegir el motivo",
    ]);
  });

  it("sin vista previa solo muestra el resultado", () => {
    expect(closeConsequences({ ...base, preview: null }).map((l) => l.text)).toEqual(["Se cerrará como «Pagado»"]);
  });
});

describe("relleno de la migración 00037 y plantilla de E-commerce", () => {
  const sql = readFileSync(join(__dirname, "../../supabase/migrations/00037_guia_gestion.sql"), "utf8");
  const json = sql.match(/\$json\$([\s\S]*?)\$json\$/)![1];
  type Seed = { type: string; stage: string; guide: string; requires: string | null; steps: { to?: string; action?: string; label?: string }[] };
  const seeds = JSON.parse(json) as Seed[];
  const template = BUSINESS_TEMPLATES.ecommerce;

  it("cubre las 11 etapas aprobadas", () => {
    expect(seeds.map((s) => `${s.type}/${s.stage}`)).toEqual([
      "Venta/Nuevo interesado",
      "Venta/Asesorando",
      "Venta/Pedido o enlace de pago enviado",
      "Venta/Esperando pago",
      "Postventa/Nueva",
      "Postventa/En gestión",
      "Postventa/Esperando al cliente",
      "Postventa/Esperando almacén o courier",
      "Recompra/Recordatorio enviado",
      "Recompra/Interesado",
      "Consulta/Abierta",
    ]);
  });

  it("cada tipo y etapa existe por nombre en la plantilla, con el mismo texto, requisito y pasos", () => {
    for (const seed of seeds) {
      const type = template.caseTypes.find((t) => t.name === seed.type);
      expect(type, `tipo ${seed.type}`).toBeDefined();
      const st = type!.stages.find((s) => s.name === seed.stage);
      expect(st, `etapa ${seed.type}/${seed.stage}`).toBeDefined();
      expect(st!.guide).toBe(seed.guide);
      expect(st!.requires ?? null).toBe(seed.requires);
      expect(st!.next).toEqual(seed.steps);
      expect(seed.guide.length).toBeLessThanOrEqual(GUIDE_TEXT_MAX);
      for (const step of seed.steps) {
        if (step.to) expect(type!.stages.some((s) => s.name === step.to), `${seed.stage} → ${step.to}`).toBe(true);
        if (step.label) expect(step.label.length).toBeLessThanOrEqual(STEP_LABEL_MAX);
      }
    }
  });

  it("el gimnasio no recibe nada: ningún nombre del relleno existe allí", () => {
    const gym = BUSINESS_TEMPLATES.gym;
    for (const seed of seeds) {
      const type = gym.caseTypes.find((t) => t.name === seed.type);
      expect(type?.stages.find((s) => s.name === seed.stage)?.guide).toBeUndefined();
    }
  });

  it("la migración es aditiva y no pisa lo que ya tiene contenido", () => {
    expect(sql).not.toMatch(/drop table|delete from|truncate/i);
    expect(sql).toMatch(/s\.guide_text is null/);
    expect(sql).toMatch(/strict_order boolean not null default false/);
  });
});
