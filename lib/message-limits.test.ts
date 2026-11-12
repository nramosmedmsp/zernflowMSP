import { describe, expect, it } from "vitest";
import {
  NOTE_MAX_CHARS,
  checkMessage,
  checkNote,
  counterLabel,
  measureText,
  messageLimitFor,
  tooLongError,
} from "./message-limits";

describe("límites de mensaje por canal", () => {
  it("WhatsApp 4 096 caracteres; Instagram 1 000 bytes; desconocido 1 000", () => {
    expect(messageLimitFor("whatsapp")).toEqual({ max: 4096, unit: "caracteres" });
    expect(messageLimitFor("instagram")).toEqual({ max: 1000, unit: "bytes" });
    expect(messageLimitFor("otro")).toEqual({ max: 1000, unit: "caracteres" });
    expect(messageLimitFor(null).max).toBe(1000);
  });

  it("borde exacto de WhatsApp: 4 096 cabe, 4 097 no", () => {
    expect(checkMessage("a".repeat(4096), "whatsapp").ok).toBe(true);
    const over = checkMessage("a".repeat(4097), "whatsapp");
    expect(over.ok).toBe(false);
    expect(over.over).toBe(1);
  });

  it("Instagram cuenta bytes: 'ñ' y los emojis pesan más", () => {
    expect(measureText("ñ", "bytes")).toBe(2);
    expect(measureText("😀", "bytes")).toBe(4);
    expect(checkMessage("ñ".repeat(500), "instagram").ok).toBe(true); // 1000 bytes justos
    expect(checkMessage("ñ".repeat(501), "instagram").ok).toBe(false);
  });

  it("un emoji cuenta como un carácter en los canales por caracteres", () => {
    expect(measureText("😀😀", "caracteres")).toBe(2);
  });

  it("el contador aparece desde el 80 %", () => {
    expect(checkMessage("a".repeat(3000), "whatsapp").showCounter).toBe(false);
    expect(checkMessage("a".repeat(3277), "whatsapp").showCounter).toBe(true);
  });

  it("textos del contador y del error", () => {
    expect(counterLabel(checkMessage("a".repeat(3900), "whatsapp"))).toMatch(/3.900 \/ 4.096 caracteres/);
    const c = checkMessage("a".repeat(4100), "whatsapp");
    expect(counterLabel(c)).toContain("Te pasas por 4");
    expect(tooLongError("whatsapp", c)).toContain("WhatsApp");
  });

  it("las notas tienen su propio tope", () => {
    expect(checkNote("a".repeat(NOTE_MAX_CHARS)).ok).toBe(true);
    expect(checkNote("a".repeat(NOTE_MAX_CHARS + 1)).ok).toBe(false);
  });
});
