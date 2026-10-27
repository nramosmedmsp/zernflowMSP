import { describe, expect, it } from "vitest";
import {
  classifySendFailure,
  failedConversationIds,
  findLikelyDelivered,
  outboxMessages,
  outboxReducer,
  settledIds,
  splitOutgoing,
  type OutboxAttachment,
  type OutboxItem,
} from "./inbox-outbox";
import { mapZernioMessage, type InboxMessage } from "./inbox-messages";

function item(extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    clientId: "k1",
    conversationId: "conv-a",
    contactName: "Patricia",
    text: "Hola Patricia",
    createdAt: "2026-10-27T10:00:00.000Z",
    status: "sending",
    error: null,
    ambiguous: false,
    confirmedId: null,
    ...extra,
  };
}

function server(id: string, text: string, at: string, direction = "outgoing"): InboxMessage {
  return mapZernioMessage({ id, direction, message: text, createdAt: at }, "conv-a") as InboxMessage;
}

describe("outboxReducer", () => {
  it("encola, marca enviado y quita lo que ya llegó al servidor", () => {
    let s = outboxReducer([], { type: "queued", item: item() });
    s = outboxReducer(s, { type: "sent", clientId: "k1", confirmedId: "wamid.1" });
    expect(s[0]).toMatchObject({ status: "sent", confirmedId: "wamid.1" });
    s = outboxReducer(s, { type: "settled", clientIds: ["k1"] });
    expect(s).toEqual([]);
  });

  it("un fallo conserva el mensaje con su motivo y el reintento lo vuelve a enviar", () => {
    let s = outboxReducer([item()], { type: "failed", clientId: "k1", error: "Sin conexión", ambiguous: true });
    expect(s[0]).toMatchObject({ status: "failed", error: "Sin conexión", ambiguous: true });
    s = outboxReducer(s, { type: "retrying", clientId: "k1" });
    expect(s[0]).toMatchObject({ status: "sending", error: null });
  });
});

describe("classifySendFailure", () => {
  it("sin red, 409 y 5xx son dudosos; 400 y 502 son rechazos", () => {
    expect(classifySendFailure(null).ambiguous).toBe(true);
    expect(classifySendFailure(409).ambiguous).toBe(true);
    expect(classifySendFailure(500).ambiguous).toBe(true);
    expect(classifySendFailure(504).ambiguous).toBe(true);
    expect(classifySendFailure(502).ambiguous).toBe(false);
    expect(classifySendFailure(400).ambiguous).toBe(false);
  });
});

describe("findLikelyDelivered", () => {
  it("encuentra el mismo texto saliente enviado desde poco antes del intento", () => {
    const found = findLikelyDelivered(item(), [
      server("x", "Hola Patricia", "2026-10-27T09:00:00.000Z"),
      server("y", "Hola Patricia", "2026-10-27T10:00:02.000Z"),
    ]);
    expect(found?.id).toBe("y");
  });

  it("no confunde un mensaje del cliente ni otro texto", () => {
    expect(
      findLikelyDelivered(item(), [
        server("a", "Hola Patricia", "2026-10-27T10:00:05.000Z", "incoming"),
        server("b", "Otro texto", "2026-10-27T10:00:05.000Z"),
      ]),
    ).toBeNull();
  });
});

describe("settledIds y outboxMessages", () => {
  it("quita lo confirmado cuando su id aparece en la lista del chat", () => {
    const items = [item({ status: "sent", confirmedId: "wamid.1" }), item({ clientId: "k2", status: "sent", confirmedId: "wamid.2" })];
    expect(settledIds(items, "conv-a", [server("wamid.1", "Hola Patricia", "2026-10-27T10:00:01.000Z")])).toEqual(["k1"]);
  });

  it("nunca muestra un envío en otro chat", () => {
    const items = [item(), item({ clientId: "k2", conversationId: "conv-b" })];
    expect(outboxMessages(items, "conv-a").map((m) => m.id)).toEqual(["outbox-k1"]);
    expect(outboxMessages(items, "conv-a")[0]).toMatchObject({ direction: "outbound", status: "pending" });
  });

  it("marca en la lista los chats con un envío fallido", () => {
    expect([...failedConversationIds([item({ status: "failed" }), item({ clientId: "k2", conversationId: "conv-b" })])]).toEqual(["conv-a"]);
  });
});

describe("archivos", () => {
  const photo: OutboxAttachment = {
    path: null,
    file: new Blob(["x"], { type: "image/jpeg" }),
    name: "foto.jpg",
    mime: "image/jpeg",
    size: 1,
    kind: "image",
    localUrl: "blob:foto",
  };

  it("WhatsApp: el texto va como pie de la primera foto", () => {
    expect(splitOutgoing("whatsapp", "Aquí tienes", ["a", "b"])).toEqual([
      { text: "Aquí tienes", file: "a" },
      { text: "", file: "b" },
    ]);
  });

  it("Instagram: el texto sale antes, aparte", () => {
    expect(splitOutgoing("instagram", "Aquí tienes", ["a"])).toEqual([
      { text: "Aquí tienes", file: null },
      { text: "", file: "a" },
    ]);
    expect(splitOutgoing("instagram", "", ["a"])).toEqual([{ text: "", file: "a" }]);
    expect(splitOutgoing("whatsapp", "Hola", [])).toEqual([{ text: "Hola", file: null }]);
  });

  it("una vez subido, el reintento no lo vuelve a subir", () => {
    const s = outboxReducer([item({ attachment: photo })], { type: "uploaded", clientId: "k1", path: "ws/conv/c/out/f.jpg" });
    expect(s[0].attachment).toMatchObject({ path: "ws/conv/c/out/f.jpg", file: null, localUrl: "blob:foto" });
  });

  it("muestra la vista previa mientras sale", () => {
    const [m] = outboxMessages([item({ text: "", attachment: photo })], "conv-a");
    expect(m.media).toEqual([{ kind: "image", name: "foto.jpg", mime: "image/jpeg", size: 1, status: "stored", url: null, localUrl: "blob:foto" }]);
  });

  it("un envío con foto no se confunde con un texto igual sin foto", () => {
    const withPhoto = item({ text: "", attachment: photo });
    const textOnly = server("t", "", "2026-10-27T10:00:02.000Z");
    expect(findLikelyDelivered(withPhoto, [textOnly])).toBeNull();
    const photoMsg = { ...server("p", "", "2026-10-27T10:00:03.000Z"), attachments: [{ type: "image" }] } as InboxMessage;
    expect(findLikelyDelivered(withPhoto, [textOnly, photoMsg])?.id).toBe("p");
  });
});
