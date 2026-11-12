import { describe, expect, it } from "vitest";
import {
  broadcastStatusText,
  canCancelBroadcast,
  cancelConfirmMessage,
  cancelledSummary,
  isBroadcastLive,
  pauseExplanation,
  progressFromCounts,
  progressPercent,
  waitingCount,
} from "./status";

describe("estados en palabras claras", () => {
  it("usa los nombres que ve el equipo", () => {
    expect(broadcastStatusText("sending")).toBe("Enviando");
    expect(broadcastStatusText("paused")).toBe("En pausa");
    expect(broadcastStatusText("cancelled")).toBe("Cancelada");
    expect(broadcastStatusText("completed")).toBe("Terminada");
  });

  it("se actualiza sola mientras envía o está en pausa, y se puede cancelar mientras no terminó", () => {
    expect(isBroadcastLive("sending")).toBe(true);
    expect(isBroadcastLive("paused")).toBe(true);
    expect(isBroadcastLive("completed")).toBe(false);
    expect(canCancelBroadcast("paused")).toBe(true);
    expect(canCancelBroadcast("scheduled")).toBe(true);
    expect(canCancelBroadcast("completed")).toBe(false);
    expect(canCancelBroadcast("cancelled")).toBe(false);
  });
});

describe("avance", () => {
  const p = progressFromCounts({ pending: 600, sending: 4, sent: 300, skipped: 10, failed: 6, cancelled: 80 });

  it("suma el total y cuenta lo que espera", () => {
    expect(p.total).toBe(1000);
    expect(waitingCount(p)).toBe(604);
    expect(progressPercent(p)).toBe(39);
  });

  it("sin destinatarios el avance es 0", () => {
    expect(progressPercent(progressFromCounts({}))).toBe(0);
  });
});

describe("confirmación de cancelar", () => {
  it("dice cuántos ya recibieron y cuántos no recibirán", () => {
    const text = cancelConfirmMessage(progressFromCounts({ sent: 320, pending: 680 }));
    expect(text).toContain("320 contactos ya recibieron");
    expect(text).toContain("680 contactos no lo recibirán");
    expect(text).toContain("no se podrá reanudar");
  });

  it("concuerda en singular", () => {
    const text = cancelConfirmMessage(progressFromCounts({ sent: 1, pending: 1 }));
    expect(text).toContain("1 contacto ya recibió");
    expect(text).toContain("1 contacto no lo recibirá");
  });

  it("si no queda nadie por enviar lo dice", () => {
    expect(cancelConfirmMessage(progressFromCounts({ sent: 5 }))).toContain("No quedan contactos por enviar");
  });

  it("el resumen tras cancelar usa las cifras reales", () => {
    expect(cancelledSummary(progressFromCounts({ sent: 320, cancelled: 680 }))).toBe(
      "Difusión cancelada. 320 contactos la recibieron y 680 no la recibirán.",
    );
  });
});

describe("motivo de la pausa", () => {
  it("la automática muestra su nota; la manual explica qué pasa al reanudar", () => {
    expect(pauseExplanation("auto_failures", "Se pausó sola: 10 envíos seguidos fallaron.")).toContain("Se pausó sola");
    expect(pauseExplanation("manual", null)).toContain("al reanudar sigue con los pendientes");
    expect(pauseExplanation("auto_failures", null)).toContain("Se pausó sola");
  });
});
