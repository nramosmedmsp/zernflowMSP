import { describe, expect, it } from "vitest";
import { applyStatusUpdate, attachLocalMeta, attachMedia, mapZernioMessage, strongerStatus, mergeMessages, pageLimit, sortMessages, type InboxMessage } from "./inbox-messages";
import { deliveryErrorText } from "./delivery-errors";

describe("mapZernioMessage", () => {
  it("reconoce 'outgoing' (lo que manda Zernio) y 'outbound' como mensajes propios", () => {
    expect(mapZernioMessage({ id: "a", direction: "outgoing" }, "c")?.direction).toBe("outbound");
    expect(mapZernioMessage({ id: "b", direction: "outbound" }, "c")?.direction).toBe("outbound");
    expect(mapZernioMessage({ id: "d", direction: "incoming" }, "c")?.direction).toBe("inbound");
  });

  it("usa el id de Zernio como id de plataforma y el texto del campo message", () => {
    const m = mapZernioMessage({ id: "wamid.1", direction: "incoming", message: "Hola", createdAt: "2026-10-27T10:00:00Z" }, "conv-1");
    expect(m).toMatchObject({ id: "wamid.1", platform_message_id: "wamid.1", text: "Hola", conversation_id: "conv-1", created_at: "2026-10-27T10:00:00Z" });
  });

  it("traduce el estado de entrega de los mensajes propios", () => {
    const status = (deliveryStatus: string | null) => mapZernioMessage({ id: "x", direction: "outgoing", deliveryStatus }, "c")?.status;
    expect(status("delivered")).toBe("delivered");
    expect(status("read")).toBe("read");
    expect(status("played")).toBe("read");
    expect(status(null)).toBe("sent");
    expect(mapZernioMessage({ id: "y", direction: "incoming", deliveryStatus: "read" }, "c")?.status).toBe("sent");
  });

  it("explica en español por qué WhatsApp no entregó un mensaje", () => {
    const m = mapZernioMessage(
      { id: "x", direction: "outgoing", deliveryStatus: "failed", deliveryError: { code: 131047, title: "Re-engagement message" } },
      "c",
    );
    expect(m?.status).toBe("failed");
    expect(m?.error).toBe("pasaron más de 24 horas desde el último mensaje del cliente");
  });

  it("marca las respuestas y menciones de historias de Instagram", () => {
    expect(mapZernioMessage({ id: "a", storyReply: true }, "c")?.story).toBe("reply");
    expect(mapZernioMessage({ id: "b", storyReply: { storyId: "1" } }, "c")?.story).toBe("reply");
    expect(mapZernioMessage({ id: "c", isStoryMention: true }, "c")?.story).toBe("mention");
    expect(mapZernioMessage({ id: "d" }, "c")?.story).toBeNull();
  });

  it("descarta lo que no tiene id y deja los adjuntos vacíos en null", () => {
    expect(mapZernioMessage({ message: "sin id" }, "c")).toBeNull();
    expect(mapZernioMessage({ id: "a", attachments: [] }, "c")?.attachments).toBeNull();
    expect(mapZernioMessage({ id: "b", attachments: [{ type: "image" }] }, "c")?.attachments).toEqual([{ type: "image" }]);
    expect(mapZernioMessage({ id: "t", attachments: [{ type: "template" }] }, "c")?.attachments).toBeNull();
  });
});

function msg(id: string, at: string, extra: Partial<InboxMessage> = {}): InboxMessage {
  return { ...(mapZernioMessage({ id, direction: "incoming", createdAt: at }, "c") as InboxMessage), ...extra };
}

describe("mergeMessages", () => {
  it("une por id, conserva lo ya cargado y deja lo nuevo con el estado más reciente", () => {
    const older = [msg("1", "2026-10-27T10:00:00Z"), msg("2", "2026-10-27T10:01:00Z", { status: "sent" })];
    const fresh = [msg("2", "2026-10-27T10:01:00Z", { status: "read" }), msg("3", "2026-10-27T10:02:00Z")];
    const merged = mergeMessages(older, fresh);
    expect(merged.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(merged[1].status).toBe("read");
  });

  it("ordena del más antiguo al más nuevo", () => {
    const list = sortMessages([msg("b", "2026-10-27T10:05:00Z"), msg("a", "2026-10-27T10:00:00Z")]);
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("pageLimit", () => {
  it("50 por defecto y entre 1 y 100", () => {
    expect(pageLimit(null)).toBe(50);
    expect(pageLimit("abc")).toBe(50);
    expect(pageLimit("0")).toBe(1);
    expect(pageLimit("500")).toBe(100);
    expect(pageLimit("20")).toBe(20);
  });
});

describe("deliveryErrorText", () => {
  it("usa el detalle original cuando el código no tiene texto propio", () => {
    expect(deliveryErrorText({ code: 1, title: "Something" })).toBe("Something");
    expect(deliveryErrorText({ message: "  " })).toBeNull();
    expect(deliveryErrorText(null)).toBeNull();
  });
});

describe("attachMedia", () => {
  const ctx = { conversationId: "conv-1" };
  const withAttachment = (id: string, attachments: unknown[]) =>
    mapZernioMessage({ id, direction: "incoming", createdAt: "2026-10-27T10:00:00Z", attachments }, "conv-1") as InboxMessage;

  it("usa la copia propia cuando existe", () => {
    const [m] = attachMedia([withAttachment("wamid.1", [{ type: "image", url: "https://zernio.com/api/v1/whatsapp/media/9" }])], [
      { id: "mm-1", platform_message_id: "wamid.1", attachment_index: 0, kind: "image", file_name: null, mime_type: "image/jpeg", size_bytes: 1000, status: "stored" },
    ], ctx);
    expect(m.media).toEqual([{ kind: "image", name: null, mime: "image/jpeg", size: 1000, status: "stored", url: "/api/v1/media/mm-1" }]);
  });

  it("sin copia, WhatsApp pasa por la ruta propia y Instagram usa su enlace", () => {
    const wa = attachMedia([withAttachment("wamid.2", [{ type: "image", url: "https://zernio.com/api/v1/whatsapp/media/9" }])], [], ctx)[0];
    expect(wa.media?.[0].url).toMatch(/^\/api\/v1\/media\/remote\?c=conv-1&m=wamid.2&i=0&u=/);
    const ig = attachMedia([withAttachment("mid.1", [{ type: "image", url: "https://scontent.cdninstagram.com/x.jpg" }])], [], ctx)[0];
    expect(ig.media?.[0]).toMatchObject({ status: "remote", url: "https://scontent.cdninstagram.com/x.jpg" });
  });

  it("marca los archivos vencidos (2 meses) y deja igual los mensajes sin archivos", () => {
    const [expired, plain] = attachMedia(
      [withAttachment("wamid.3", [{ type: "file" }]), withAttachment("wamid.4", [])],
      [{ id: "mm-3", platform_message_id: "wamid.3", attachment_index: 0, kind: "file", file_name: "lista.pdf", mime_type: "application/pdf", size_bytes: 10, status: "expired" }],
      ctx,
    );
    expect(expired.media?.[0]).toMatchObject({ status: "expired", url: null, name: "lista.pdf" });
    expect(plain.media).toBeUndefined();
  });

  it("un archivo enviado desde la bandeja aparece aunque la lista no traiga adjuntos", () => {
    const sent = mapZernioMessage({ id: "wamid.5", direction: "outgoing", message: "Te paso la lista" }, "conv-1") as InboxMessage;
    const [m] = attachMedia([sent], [
      { id: "mm-5", platform_message_id: "wamid.5", attachment_index: 0, kind: "file", file_name: "lista.pdf", mime_type: "application/pdf", size_bytes: 10, status: "stored" },
    ], ctx);
    expect(m.media?.[0]).toMatchObject({ status: "stored", url: "/api/v1/media/mm-5", name: "lista.pdf" });
  });
});

describe("autor y estado registrados", () => {
  const out = (id: string, deliveryStatus: string | null = null) =>
    mapZernioMessage({ id, direction: "outgoing", message: "Hola", createdAt: "2026-10-27T10:00:00Z", deliveryStatus }, "c") as InboxMessage;
  const meta = (id: string, extra: Partial<Parameters<typeof attachLocalMeta>[1][number]> = {}) => ({
    platform_message_id: id,
    sent_by_user_id: null,
    sent_by_flow_id: null,
    status: "sent" as const,
    error_text: null,
    ...extra,
  });

  it("los ticks nunca retroceden y leído gana", () => {
    expect(strongerStatus("delivered", "sent")).toBe("delivered");
    expect(strongerStatus("sent", "read")).toBe("read");
    expect(strongerStatus("delivered", "failed")).toBe("failed");
    expect(strongerStatus("read", "failed")).toBe("read");
  });

  it("une el autor y el nombre del flujo por id de plataforma", () => {
    const [a, b, c] = attachLocalMeta(
      [out("w1"), out("w2"), out("w3")],
      [meta("w1", { sent_by_user_id: "u-ana" }), meta("w2", { sent_by_flow_id: "f1" })],
      { f1: "Bienvenida" },
    );
    expect(a.sent_by_user_id).toBe("u-ana");
    expect(b).toMatchObject({ sent_by_flow_id: "f1", flow_name: "Bienvenida" });
    expect(c.sent_by_user_id).toBeNull();
  });

  it("usa el estado del webhook si va más adelante, con su motivo", () => {
    const [m] = attachLocalMeta([out("w1", "delivered")], [meta("w1", { status: "read" })]);
    expect(m.status).toBe("read");
    const [f] = attachLocalMeta([out("w2")], [meta("w2", { status: "failed", error_text: "pasaron más de 24 horas" })]);
    expect(f).toMatchObject({ status: "failed", error: "pasaron más de 24 horas" });
    const [kept] = attachLocalMeta([out("w3", "read")], [meta("w3", { status: "delivered" })]);
    expect(kept.status).toBe("read");
  });

  it("aplica los cambios en vivo solo a mensajes propios y sin retroceder", () => {
    const list = [out("w1"), out("w2", "read")];
    const next = applyStatusUpdate(list, { platform_message_id: "w1", status: "delivered" });
    expect(next[0].status).toBe("delivered");
    expect(applyStatusUpdate(next, { platform_message_id: "w2", status: "delivered" })).toBe(next);
    expect(applyStatusUpdate(list, { platform_message_id: null, status: "read" })).toBe(list);
  });
});
