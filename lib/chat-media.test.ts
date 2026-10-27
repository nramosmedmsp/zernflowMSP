import { describe, expect, it } from "vitest";
import {
  acceptFor,
  baseMime,
  canSendAttachments,
  classifyMime,
  conversationMediaPath,
  downloadHref,
  formatFileSize,
  imageMaxBytes,
  validateReplyAttachment,
  inboundFetchPlan,
  parseMediaPath,
  replyMediaPath,
  retentionCutoff,
  safeFileName,
  validateOutgoingAttachment,
} from "./chat-media";

const WS = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const MB = 1024 * 1024;

describe("tipos de archivo", () => {
  it("quita los parámetros del MIME y clasifica", () => {
    expect(baseMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(classifyMime("image/png")).toBe("image");
    expect(classifyMime("application/pdf")).toBe("file");
    expect(classifyMime("video/mp4")).toBe("video");
  });

  it("nombres seguros para mostrar y descargar", () => {
    expect(safeFileName("../../lista precios.pdf")).toBe("..-..-lista precios.pdf");
    expect(safeFileName('a"b<c>.pdf')).toBe("abc.pdf");
    expect(safeFileName("   ")).toBe("archivo");
  });
});

describe("validateOutgoingAttachment", () => {
  it("WhatsApp: fotos JPG y PNG hasta 5 MB; las más grandes se achican", () => {
    expect(validateOutgoingAttachment("whatsapp", { mime: "image/jpeg", size: 2 * MB })).toEqual({ ok: true, kind: "image", compress: false });
    expect(validateOutgoingAttachment("whatsapp", { mime: "image/jpeg", size: 9 * MB })).toEqual({ ok: true, kind: "image", compress: true });
    expect(validateOutgoingAttachment("whatsapp", { mime: "image/webp", size: 1 * MB })).toEqual({ ok: true, kind: "image", compress: true });
  });

  it("WhatsApp: PDF hasta 25 MB", () => {
    expect(validateOutgoingAttachment("whatsapp", { mime: "application/pdf", size: 3 * MB })).toMatchObject({ ok: true, kind: "file" });
    expect(validateOutgoingAttachment("whatsapp", { mime: "application/pdf", size: 30 * MB })).toMatchObject({ ok: false });
  });

  it("Instagram no acepta PDF", () => {
    expect(validateOutgoingAttachment("instagram", { mime: "application/pdf", size: MB })).toEqual({
      ok: false,
      error: "Instagram no permite enviar PDF. Manda una foto o un enlace.",
    });
  });

  it("canales sin archivos", () => {
    expect(canSendAttachments("bluesky")).toBe(false);
    expect(validateOutgoingAttachment("reddit", { mime: "image/png", size: 10 })).toMatchObject({ ok: false });
    expect(acceptFor("bluesky")).toBe("");
    expect(acceptFor("whatsapp")).toContain("application/pdf");
  });

  it("formatos que no son foto ni PDF", () => {
    expect(validateOutgoingAttachment("whatsapp", { mime: "application/zip", size: 10 })).toMatchObject({ ok: false });
    expect(validateOutgoingAttachment("whatsapp", { mime: "image/heic", size: 10 })).toMatchObject({ ok: false });
  });
});

describe("rutas del bucket", () => {
  it("arma y valida rutas de chats y de respuestas", () => {
    const path = conversationMediaPath(WS, CONV, "out", "image/png", ID);
    expect(path).toBe(`${WS}/conv/${CONV}/out/${ID}.png`);
    expect(parseMediaPath(path)).toEqual({ kind: "conv", workspaceId: WS, conversationId: CONV, direction: "out", file: `${ID}.png` });
    const reply = replyMediaPath(WS, "application/pdf", ID);
    expect(parseMediaPath(reply)).toEqual({ kind: "replies", workspaceId: WS, file: `${ID}.pdf` });
  });

  it("rechaza rutas con forma rara", () => {
    expect(parseMediaPath(`${WS}/conv/${CONV}/out/../${ID}.png`)).toBeNull();
    expect(parseMediaPath(`${WS}/conv/${CONV}/x/${ID}.png`)).toBeNull();
    expect(parseMediaPath(`otro/replies/${ID}.pdf`)).toBeNull();
    expect(parseMediaPath(`${WS}/replies/archivo.pdf`)).toBeNull();
    expect(parseMediaPath(42)).toBeNull();
  });
});

describe("inboundFetchPlan", () => {
  it("la clave de Zernio solo viaja a zernio.com", () => {
    expect(inboundFetchPlan("https://zernio.com/api/v1/whatsapp/media/123")).toEqual({ ok: true, withApiKey: true });
    expect(inboundFetchPlan("https://scontent.xx.fbcdn.net/v/foto.jpg")).toEqual({ ok: true, withApiKey: false });
    expect(inboundFetchPlan("https://evil.com/zernio.com")).toEqual({ ok: false });
    expect(inboundFetchPlan("http://zernio.com/api/x")).toEqual({ ok: false });
    expect(inboundFetchPlan("no es url")).toEqual({ ok: false });
  });
});

describe("retentionCutoff", () => {
  it("los archivos vencen a los 2 meses (60 días)", () => {
    expect(retentionCutoff(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("formatFileSize y downloadHref", () => {
  it("tamaños legibles", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(220 * 1024)).toBe("220 KB");
    expect(formatFileSize(1.2 * MB)).toBe("1.2 MB");
    expect(formatFileSize(null)).toBe("");
  });

  it("descarga con nombre solo por nuestras rutas", () => {
    expect(downloadHref("/api/v1/media/abc")).toBe("/api/v1/media/abc?download=1");
    expect(downloadHref("/api/v1/media/remote?c=1")).toBe("/api/v1/media/remote?c=1&download=1");
    expect(downloadHref("https://scontent.cdninstagram.com/x.jpg")).toBe("https://scontent.cdninstagram.com/x.jpg");
  });
});

describe("validateReplyAttachment", () => {
  it("fotos JPG/PNG hasta 5 MB (las grandes se achican) y PDF hasta 25 MB", () => {
    expect(validateReplyAttachment({ mime: "image/png", size: MB })).toEqual({ ok: true, kind: "image", compress: false });
    expect(validateReplyAttachment({ mime: "image/jpeg", size: 7 * MB })).toEqual({ ok: true, kind: "image", compress: true });
    expect(validateReplyAttachment({ mime: "application/pdf", size: 10 * MB })).toMatchObject({ ok: true, kind: "file" });
    expect(validateReplyAttachment({ mime: "application/pdf", size: 30 * MB })).toMatchObject({ ok: false });
    expect(validateReplyAttachment({ mime: "video/mp4", size: MB })).toMatchObject({ ok: false });
    expect(imageMaxBytes("instagram")).toBe(8 * MB);
  });
});
