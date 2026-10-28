import { describe, expect, it } from "vitest";
import type { SolutionCaseInput } from "@/lib/cases/protection";
import {
  closeMenuItems,
  closeOptions,
  closeRequestLine,
  closeSelection,
  commitmentOptions,
  nextContactChip,
  nextContactOptions,
  relativeDayTime,
  solutionBanner,
  stageSteps,
  typeChangeLock,
} from "./case-card-model";

const stage = (id: string, name: string, kind: "open" | "won" | "lost" | "resolved" = "open", archived = false) => ({
  id,
  name,
  kind,
  archived,
});

const venta = [
  stage("s1", "Nuevo interesado"),
  stage("s2", "Asesorando"),
  stage("s3", "Pedido o enlace de pago enviado"),
  stage("s4", "Esperando pago"),
  stage("w", "Pagado", "won"),
  stage("l", "No compró", "lost"),
];

// Miércoles 28 oct 2026, 10:00 en Lima.
const NOW = new Date("2026-10-28T15:00:00Z");

describe("stageSteps", () => {
  it("marca pasadas, actual y siguientes en orden", () => {
    const steps = stageSteps(venta, "s2");
    expect(steps.map((s) => s.state)).toEqual(["past", "current", "next", "next"]);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("sin etapa actual todo queda como siguiente", () => {
    expect(stageSteps(venta, null).every((s) => s.state === "next")).toBe(true);
  });

  it("omite finales y archivadas, salvo la actual", () => {
    const stages = [stage("a", "A"), stage("b", "B", "open", true), stage("c", "C")];
    expect(stageSteps(stages, "a").map((s) => s.id)).toEqual(["a", "c"]);
    expect(stageSteps(stages, "b").map((s) => [s.id, s.state])).toEqual([
      ["a", "past"],
      ["b", "current"],
      ["c", "next"],
    ]);
  });

  it("una etapa que no existe deja todo como siguiente", () => {
    expect(stageSteps(venta, "zzz").every((s) => s.state === "next")).toBe(true);
  });
});

describe("closeOptions", () => {
  it("lista las finales con ganadas primero y tono por resultado", () => {
    const options = closeOptions(venta);
    expect(options.map((o) => [o.name, o.tone])).toEqual([
      ["Pagado", "positive"],
      ["No compró", "negative"],
    ]);
  });

  it("pone resuelta antes que perdida aunque venga después", () => {
    const stages = [stage("a", "A"), stage("l", "Sin solución", "lost"), stage("r", "Resuelta", "resolved")];
    expect(closeOptions(stages).map((o) => o.name)).toEqual(["Resuelta", "Sin solución"]);
  });

  it("ignora finales archivadas", () => {
    const stages = [stage("w", "Compró", "won"), stage("l", "No compró", "lost", true)];
    expect(closeOptions(stages).map((o) => o.name)).toEqual(["Compró"]);
  });

  it("sin tipo o sin finales ofrece resolver", () => {
    expect(closeOptions(null)).toEqual([{ stageId: null, name: "Resuelta", kind: "resolved", tone: "positive" }]);
    expect(closeOptions([stage("a", "A")])).toHaveLength(1);
  });
});

describe("closeSelection", () => {
  it("la primera final de un resultado se envía vacía", () => {
    expect(closeSelection(venta, "w")).toEqual({ kind: "won", stageId: "" });
    expect(closeSelection(venta, "l")).toEqual({ kind: "lost", stageId: "" });
  });

  it("una segunda final del mismo resultado conserva su id", () => {
    const stages = [stage("a", "A"), stage("r1", "Resuelta", "resolved"), stage("r2", "Resuelta con nota", "resolved")];
    expect(closeSelection(stages, "r2")).toEqual({ kind: "resolved", stageId: "r2" });
  });

  it("devuelve null si no hay etapa o no es final", () => {
    expect(closeSelection(venta, null)).toBeNull();
    expect(closeSelection(venta, "s1")).toBeNull();
  });
});

describe("nextContactChip", () => {
  it("sin fecha invita a programar", () => {
    expect(nextContactChip(null, NOW)).toEqual({ label: "Programar", tone: "none" });
  });

  it("mañana a las 9:00", () => {
    expect(nextContactChip("2026-10-29T14:00:00Z", NOW)).toEqual({ label: "Mañana 9:00", tone: "ok" });
  });

  it("hoy más tarde", () => {
    expect(nextContactChip("2026-10-28T23:30:00Z", NOW)).toEqual({ label: "Hoy 18:30", tone: "ok" });
  });

  it("atrasado ayer", () => {
    expect(nextContactChip("2026-10-27T15:00:00Z", NOW)).toEqual({ label: "Atrasado: ayer 10:00", tone: "overdue" });
  });

  it("atrasado hoy", () => {
    expect(nextContactChip("2026-10-28T13:15:00Z", NOW)).toEqual({ label: "Atrasado: hoy 8:15", tone: "overdue" });
  });

  it("usa día de la semana dentro de la semana y fecha después", () => {
    expect(nextContactChip("2026-11-02T14:00:00Z", NOW).label).toBe("Lun 9:00");
    expect(nextContactChip("2026-11-20T14:00:00Z", NOW).label).toBe("20 nov 9:00");
  });

  it("usa el día de Lima, no el de UTC", () => {
    // 02:00 UTC del 29 = 21:00 del 28 en Lima.
    expect(relativeDayTime(new Date("2026-10-29T02:00:00Z"), NOW)).toBe("hoy 21:00");
  });

  it("una fecha inválida se trata como sin programar", () => {
    expect(nextContactChip("no es fecha", NOW).tone).toBe("none");
  });
});

describe("nextContactOptions", () => {
  it("miércoles: en 3 h, mañana y lunes", () => {
    const options = nextContactOptions(NOW);
    expect(options.map((o) => o.key)).toEqual(["three-hours", "tomorrow", "monday"]);
    expect(options[0]).toMatchObject({ at: "2026-10-28T18:00:00.000Z", detail: "13:00" });
    expect(options[1]).toMatchObject({ at: "2026-10-29T14:00:00.000Z", detail: "jue 29 oct · 9:00" });
    expect(options[2]).toMatchObject({ at: "2026-11-02T14:00:00.000Z", detail: "lun 2 nov · 9:00" });
  });

  it("domingo: el lunes es mañana, no se repite", () => {
    const sunday = new Date("2026-11-01T15:00:00Z");
    expect(nextContactOptions(sunday).map((o) => o.key)).toEqual(["three-hours", "tomorrow"]);
  });

  it("lunes: el próximo lunes es en 7 días", () => {
    const monday = new Date("2026-11-02T15:00:00Z");
    const monOpt = nextContactOptions(monday).find((o) => o.key === "monday");
    expect(monOpt?.at).toBe("2026-11-09T14:00:00.000Z");
  });
});

// ------------------------------------------------------ Control de reclamos

describe("closeMenuItems", () => {
  const options = closeOptions([stage("a", "Nueva"), stage("r", "Resuelta", "resolved"), stage("l", "Sin solución", "lost")]);

  it("el asesor ve que cerrar sin solución requiere aprobación", () => {
    const items = closeMenuItems(options, { isProtected: true, canSupervise: false, hasPendingRequest: false });
    expect(items.map((i) => [i.label, i.needsApproval, i.disabledReason])).toEqual([
      ["Resuelta", false, null],
      ["Sin solución (requiere aprobación)", true, null],
    ]);
  });

  it("con un pedido pendiente no puede pedir otro", () => {
    const items = closeMenuItems(options, { isProtected: true, canSupervise: false, hasPendingRequest: true });
    expect(items[1].disabledReason).toMatch(/pedido de cierre/);
    expect(items[0].disabledReason).toBeNull();
  });

  it("el supervisor y los tipos sin protección cierran directo", () => {
    for (const ctx of [
      { isProtected: true, canSupervise: true, hasPendingRequest: true },
      { isProtected: false, canSupervise: false, hasPendingRequest: false },
    ]) {
      expect(closeMenuItems(options, ctx).map((i) => [i.label, i.needsApproval, i.disabledReason])).toEqual([
        ["Resuelta", false, null],
        ["Sin solución", false, null],
      ]);
    }
  });
});

describe("typeChangeLock", () => {
  it("bloquea a quien no es supervisor en un tipo protegido", () => {
    expect(typeChangeLock({ name: "Postventa", protected: true }, false)).toBe(
      "Solo el supervisor puede cambiar el tipo de una Postventa.",
    );
    expect(typeChangeLock({ name: "Postventa", protected: true }, true)).toBeNull();
    expect(typeChangeLock({ name: "Venta", protected: false }, false)).toBeNull();
    expect(typeChangeLock(null, false)).toBeNull();
  });
});

describe("closeRequestLine", () => {
  it("junta quién, motivo y nota", () => {
    expect(
      closeRequestLine({ stageName: "Sin solución", requesterName: "Marco", reasonName: "No responde", note: "3 intentos" }),
    ).toBe("Pedido de cierre «Sin solución» por Marco · No responde · 3 intentos");
    expect(closeRequestLine({ stageName: null, requesterName: "Marco", reasonName: null, note: null })).toBe(
      "Pedido de cierre «Sin solución» por Marco",
    );
  });
});

describe("solutionBanner", () => {
  const base: SolutionCaseInput = {
    status: "open",
    openedAt: "2026-10-28T10:00:00Z", // 5:00 en Lima
    solutionStatus: null,
    solutionNote: null,
    nextActionAt: null,
  };
  const banner = (c: Partial<SolutionCaseInput>, now = NOW, hours: number | null = 24) =>
    solutionBanner({ typeName: "Postventa", deadlineHours: hours, case: { ...base, ...c } }, now);

  it("ámbar con la hora límite y cuánto queda", () => {
    // Abierta 5:00, vence mañana 5:00; ahora 10:00 → quedan 19 h.
    expect(banner({})).toEqual({
      tone: "amber",
      text: "Postventa: registra la solución antes de mañana 5:00 (quedan 19 h)",
      action: "register",
      actionLabel: "Registrar solución",
    });
    expect(banner({ openedAt: "2026-10-27T16:00:00Z" })?.text).toBe(
      "Postventa: registra la solución antes de hoy 11:00 (quedan 1 h)",
    );
  });

  it("roja cuando se pasó el plazo", () => {
    const b = banner({ openedAt: "2026-10-27T10:00:00Z" });
    expect(b).toMatchObject({ tone: "red", action: "register" });
    expect(b?.text).toBe("Atrasada: debía registrarse la solución hace 5 h");
  });

  it("el plazo corre desde la reapertura cuando existe", () => {
    expect(banner({ openedAt: "2026-10-01T10:00:00Z", solutionClockAt: "2026-10-28T14:00:00Z" })?.tone).toBe("amber");
  });

  it("solución en proceso al día y con el compromiso vencido", () => {
    const ok = banner({ solutionStatus: "in_progress", solutionNote: "Cambio del producto", nextActionAt: "2026-10-30T23:00:00Z" });
    expect(ok).toEqual({
      tone: "ok",
      text: "Solución en proceso: Cambio del producto · compromiso vie 18:00",
      action: "update",
      actionLabel: "Actualizar",
    });
    const late = banner({ solutionStatus: "in_progress", solutionNote: "Cambio del producto", nextActionAt: "2026-10-28T13:00:00Z" });
    expect(late).toMatchObject({ tone: "red", text: "Compromiso vencido (hoy 8:00): Cambio del producto" });
  });

  it("no muestra nada sin plazo o si la gestión no está abierta", () => {
    expect(banner({}, NOW, null)).toBeNull();
    expect(banner({ status: "resolved" })).toBeNull();
  });
});

describe("commitmentOptions", () => {
  it("hoy, mañana y en 2 días a las 18:00 de Lima", () => {
    expect(commitmentOptions(NOW).map((o) => [o.label, o.at, o.detail])).toEqual([
      ["Hoy", "2026-10-28T23:00:00.000Z", "hoy 18:00"],
      ["Mañana", "2026-10-29T23:00:00.000Z", "mañana 18:00"],
      ["En 2 días", "2026-10-30T23:00:00.000Z", "vie 18:00"],
    ]);
  });

  it("pasadas las 17:00 ya no ofrece «Hoy»", () => {
    const late = new Date("2026-10-28T22:30:00Z"); // 17:30
    expect(commitmentOptions(late).map((o) => o.label)).toEqual(["Mañana", "En 2 días"]);
  });
});
