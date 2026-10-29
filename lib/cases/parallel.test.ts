import { describe, expect, it } from "vitest";
import { allowsSameTypeParallel, sameTypeConfirmMessage } from "./parallel";
import { PARALLEL_CONFIRM_MESSAGE, SAME_TYPE_OPEN_MESSAGE, parallelOpeningError } from "./open";

const venta = { protected: false, stages: [{ kind: "open" }, { kind: "won" }, { kind: "lost" }] };
const consulta = { protected: false, stages: [{ kind: "open" }, { kind: "resolved" }] };
const postventa = { protected: true, stages: [{ kind: "open" }, { kind: "resolved" }, { kind: "lost" }] };

describe("gestiones paralelas del mismo tipo", () => {
  it("se admiten en tipos comerciales no protegidos", () => {
    expect(allowsSameTypeParallel(venta)).toBe(true);
    expect(allowsSameTypeParallel(consulta)).toBe(false);
    expect(allowsSameTypeParallel(postventa)).toBe(false);
    // Una etapa ganada archivada ya no cuenta.
    expect(allowsSameTypeParallel({ protected: false, stages: [{ kind: "won", archived: true }] })).toBe(false);
  });

  it("el mensaje usa el nombre del tipo en minúscula", () => {
    expect(sameTypeConfirmMessage("Recompra")).toBe("Este cliente ya tiene una recompra abierta. ¿Abrir otra?");
  });

  it("parallelOpeningError: pide confirmar, bloquea o deja pasar", () => {
    const existing = [{ id: "c1", caseTypeId: "venta", status: "open" as const }];
    const allowed = { allowed: true, typeName: "Venta" };
    expect(parallelOpeningError(existing, "venta", false, allowed)).toBe("Este cliente ya tiene una venta abierta. ¿Abrir otra?");
    expect(parallelOpeningError(existing, "venta", true, allowed)).toBeNull();
    expect(parallelOpeningError(existing, "venta", true)).toBe(SAME_TYPE_OPEN_MESSAGE);
    expect(parallelOpeningError(existing, "otro", false)).toBe(PARALLEL_CONFIRM_MESSAGE);
    expect(parallelOpeningError([], "venta", false)).toBeNull();
    // Sin clasificar nunca se duplica.
    expect(parallelOpeningError([{ id: "c2", caseTypeId: null, status: "open" }], null, true, allowed)).toBe(SAME_TYPE_OPEN_MESSAGE);
  });
});
