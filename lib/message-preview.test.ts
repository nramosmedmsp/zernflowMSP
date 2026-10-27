import { describe, it, expect } from "vitest";
import { inboundPreview, messagePreview } from "./message-preview";

describe("messagePreview", () => {
  it("returns short text unchanged", () => {
    expect(messagePreview("hello")).toBe("hello");
  });

  it("handles null and undefined", () => {
    expect(messagePreview(null)).toBe("");
    expect(messagePreview(undefined)).toBe("");
  });

  it("never leaves a lone surrogate at the cut, which PostgREST rejects", () => {
    // 99 chars then an emoji, so a UTF-16 slice(0, 100) splits the pair.
    const text = "a".repeat(99) + "😀" + "tail";

    expect(text.slice(0, 100).isWellFormed()).toBe(false);
    expect(messagePreview(text).isWellFormed()).toBe(true);
  });

  it("counts emoji as one character rather than two", () => {
    expect(messagePreview("😀".repeat(120))).toBe("😀".repeat(100));
  });
});

describe("inboundPreview", () => {
  it("devuelve el texto cuando no hay adjuntos", () => {
    expect(inboundPreview({ text: "Hola" })).toBe("Hola");
  });

  it("etiqueta fotos, audios y documentos sin texto", () => {
    expect(inboundPreview({ text: null, attachments: [{ type: "image" }] })).toBe("📷 Foto");
    expect(inboundPreview({ attachments: [{ type: "audio", payload: { voice: true } }] })).toBe("🎤 Nota de voz");
    expect(inboundPreview({ attachments: [{ type: "audio" }] })).toBe("🎵 Audio");
    expect(inboundPreview({ attachments: [{ type: "file" }] })).toBe("📄 Documento");
  });

  it("junta la etiqueta con el pie de foto", () => {
    expect(inboundPreview({ text: "¿es original?", attachments: [{ type: "image" }] })).toBe("📷 Foto · ¿es original?");
  });

  it("marca las respuestas y menciones de historias", () => {
    expect(inboundPreview({ text: "¿Precio?", storyReply: true })).toBe("↩️ Respondió a tu historia · ¿Precio?");
    expect(inboundPreview({ isStoryMention: true })).toBe("Te mencionó en su historia");
  });

  it("nunca queda vacía", () => {
    expect(inboundPreview({ text: "  " })).toBe("Mensaje sin texto");
  });
});
