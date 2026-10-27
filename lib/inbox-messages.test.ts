import { describe, expect, it } from "vitest";
import { mapZernioMessage, mergeMessages, pageLimit, sortMessages, type InboxMessage } from "./inbox-messages";
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
