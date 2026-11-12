import { describe, expect, it } from "vitest";
import {
  BROADCAST_AUTO_PAUSE_AFTER_FAILURES,
  BROADCAST_CONCURRENCY,
  BROADCAST_SENDS_PER_PASS,
  BROADCAST_START_LIMIT_MS,
  OTHER_JOBS_START_LIMIT_MS,
  describeBroadcastEta,
  estimateBroadcastMinutes,
} from "./pacing";

describe("ritmo de las difusiones", () => {
  it("las constantes tienen valores prudentes y coherentes con la pasada de 60 s", () => {
    expect(BROADCAST_SENDS_PER_PASS).toBe(50);
    expect(BROADCAST_CONCURRENCY).toBeLessThanOrEqual(5);
    expect(BROADCAST_AUTO_PAUSE_AFTER_FAILURES).toBe(10);
    // Un envío puede tardar 20 s: no se empieza uno pasados 35 s; las esperas del bot dejan margen a las difusiones.
    expect(BROADCAST_START_LIMIT_MS + 20_000).toBeLessThan(60_000);
    expect(OTHER_JOBS_START_LIMIT_MS).toBeLessThan(BROADCAST_START_LIMIT_MS);
  });

  it("una difusión de 1 000 tarda 20 minutos y una de 5 000, 1 hora y 40 minutos", () => {
    expect(estimateBroadcastMinutes(1000)).toBe(20);
    expect(estimateBroadcastMinutes(5000)).toBe(100);
    expect(describeBroadcastEta(1000)).toBe("unos 20 minutos");
    expect(describeBroadcastEta(5000)).toBe("1 hora y 40 minutos");
  });

  it("casos pequeños y redondos", () => {
    expect(estimateBroadcastMinutes(0)).toBe(0);
    expect(estimateBroadcastMinutes(1)).toBe(1);
    expect(estimateBroadcastMinutes(51)).toBe(2);
    expect(describeBroadcastEta(0)).toBe("menos de un minuto");
    expect(describeBroadcastEta(30)).toBe("un minuto");
    expect(describeBroadcastEta(3000)).toBe("una hora");
    expect(describeBroadcastEta(6000)).toBe("unas 2 horas");
  });
});
