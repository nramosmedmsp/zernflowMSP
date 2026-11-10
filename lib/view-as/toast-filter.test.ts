import { afterEach, describe, expect, it } from "vitest";
import {
  READ_ONLY_ERROR_WINDOW_MS,
  markReadOnlyBlock,
  resetToastFilter,
  setToastViewActive,
  shouldSuppressErrorToast,
  shouldSuppressErrorToastNow,
} from "./toast-filter";

afterEach(() => resetToastFilter());

describe("shouldSuppressErrorToast", () => {
  it("no descarta nada sin vista", () => {
    expect(shouldSuppressErrorToast({ viewActive: false, blockedAt: 1000 }, 1000)).toBe(false);
  });
  it("no descarta si no hubo bloqueo", () => {
    expect(shouldSuppressErrorToast({ viewActive: true, blockedAt: null }, 1000)).toBe(false);
  });
  it("descarta el error cercano al bloqueo (antes o después)", () => {
    expect(shouldSuppressErrorToast({ viewActive: true, blockedAt: 10_000 }, 10_500)).toBe(true);
    expect(shouldSuppressErrorToast({ viewActive: true, blockedAt: 10_000 }, 9_500)).toBe(true);
  });
  it("no descarta un error lejano al bloqueo", () => {
    expect(shouldSuppressErrorToast({ viewActive: true, blockedAt: 10_000 }, 10_000 + READ_ONLY_ERROR_WINDOW_MS + 1)).toBe(false);
  });
});

describe("estado de módulo", () => {
  it("marca el bloqueo y sobrevive a un re-armado de la franja", () => {
    setToastViewActive(true);
    markReadOnlyBlock(5_000);
    expect(shouldSuppressErrorToastNow(5_200)).toBe(true);
    setToastViewActive(false);
    setToastViewActive(true);
    expect(shouldSuppressErrorToastNow(5_200)).toBe(true);
  });
  it("sin vista no descarta nada", () => {
    setToastViewActive(true);
    markReadOnlyBlock(5_000);
    setToastViewActive(false);
    expect(shouldSuppressErrorToastNow(5_200)).toBe(false);
  });
});
