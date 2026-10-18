import { describe, expect, it } from "vitest";
import {
  pickWhatsAppTarget,
  planTemplateRecipients,
  planTextRecipients,
  type ChannelInfo,
  type ContactCandidate,
} from "./recipients";
import { isWindowOpen, windowCutoffIso } from "./window";

const NOW = Date.parse("2026-10-18T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const WA: ChannelInfo = { id: "ch-wa", platform: "whatsapp", isActive: true };
const IG: ChannelInfo = { id: "ch-ig", platform: "instagram", isActive: true };
const WA_OFF: ChannelInfo = { id: "ch-off", platform: "whatsapp", isActive: false };

function contact(id: string, extra: Partial<ContactCandidate> = {}): ContactCandidate {
  return { id, phone: null, links: [], conversations: [], ...extra };
}

describe("ventana de 24 h", () => {
  it("abre si el último mensaje entrante es de hace menos de 24 h", () => {
    expect(isWindowOpen(hoursAgo(1), NOW)).toBe(true);
    expect(isWindowOpen(hoursAgo(24), NOW)).toBe(true);
    expect(isWindowOpen(hoursAgo(24.01), NOW)).toBe(false);
  });
  it("sin mensaje entrante o con fecha inválida está cerrada", () => {
    expect(isWindowOpen(null, NOW)).toBe(false);
    expect(isWindowOpen("no es fecha", NOW)).toBe(false);
  });
  it("el corte es 24 h antes", () => {
    expect(windowCutoffIso(NOW)).toBe(hoursAgo(24));
  });
});

describe("planTextRecipients", () => {
  it("incluye solo contactos con la ventana abierta y cuenta a los demás por motivo", () => {
    const plan = planTextRecipients(
      [
        contact("abierta", { conversations: [{ channelId: WA.id, lateConversationId: "lc1", lastInboundAt: hoursAgo(2) }] }),
        contact("cerrada", { conversations: [{ channelId: WA.id, lateConversationId: "lc2", lastInboundAt: hoursAgo(30) }] }),
        contact("nunca-escribio", { conversations: [{ channelId: WA.id, lateConversationId: "lc3", lastInboundAt: null }] }),
        contact("sin-conversacion", { phone: "+51 999 111 222" }),
      ],
      [WA, IG],
      NOW,
    );
    expect(plan.recipients).toEqual([{ contactId: "abierta", channelId: WA.id }]);
    expect(plan.excluded).toEqual({ noConversation: 1, closedWindow: 2 });
  });

  it("elige la conversación con la ventana abierta más reciente", () => {
    const plan = planTextRecipients(
      [
        contact("c", {
          conversations: [
            { channelId: WA.id, lateConversationId: "a", lastInboundAt: hoursAgo(10) },
            { channelId: IG.id, lateConversationId: "b", lastInboundAt: hoursAgo(1) },
          ],
        }),
      ],
      [WA, IG],
      NOW,
    );
    expect(plan.recipients).toEqual([{ contactId: "c", channelId: IG.id }]);
  });

  it("ignora conversaciones de canales inactivos o sin ID de Zernio", () => {
    const plan = planTextRecipients(
      [
        contact("inactivo", { conversations: [{ channelId: WA_OFF.id, lateConversationId: "x", lastInboundAt: hoursAgo(1) }] }),
        contact("sin-id", { conversations: [{ channelId: WA.id, lateConversationId: null, lastInboundAt: hoursAgo(1) }] }),
      ],
      [WA, WA_OFF],
      NOW,
    );
    expect(plan.recipients).toEqual([]);
    expect(plan.excluded.noConversation).toBe(2);
  });

  it("una conversación abierta salva al contacto aunque otra esté cerrada", () => {
    const plan = planTextRecipients(
      [
        contact("c", {
          conversations: [
            { channelId: WA.id, lateConversationId: "a", lastInboundAt: hoursAgo(50) },
            { channelId: IG.id, lateConversationId: "b", lastInboundAt: hoursAgo(5) },
          ],
        }),
      ],
      [WA, IG],
      NOW,
    );
    expect(plan.recipients).toHaveLength(1);
    expect(plan.excluded).toEqual({ noConversation: 0, closedWindow: 0 });
  });
});

describe("planTemplateRecipients", () => {
  it("alcanza a contactos importados que nunca escribieron, por contacts.phone", () => {
    const plan = planTemplateRecipients([contact("importado", { phone: "+51 987 654 321" })], [IG, WA]);
    expect(plan.recipients).toEqual([{ contactId: "importado", channelId: WA.id, phone: "51987654321" }]);
  });

  it("prefiere el teléfono del canal de WhatsApp del contacto", () => {
    const plan = planTemplateRecipients(
      [contact("c", { phone: "111", links: [{ channelId: WA.id, senderId: "51900000001" }] })],
      [WA],
    );
    expect(plan.recipients[0]).toEqual({ contactId: "c", channelId: WA.id, phone: "51900000001" });
  });

  it("deja fuera a quien no tiene teléfono", () => {
    const plan = planTemplateRecipients(
      [contact("a"), contact("b", { phone: "  " }), contact("c", { links: [{ channelId: IG.id, senderId: "ig_user" }] })],
      [WA, IG],
    );
    expect(plan.recipients).toEqual([]);
    expect(plan.excluded.noPhone).toBe(3);
  });

  it("sin canal de WhatsApp activo nadie recibe", () => {
    const plan = planTemplateRecipients([contact("a", { phone: "51999" })], [WA_OFF, IG]);
    expect(plan.recipients).toEqual([]);
    expect(plan.excluded.noWhatsAppChannel).toBe(1);
  });

  it("pickWhatsAppTarget ignora enlaces de otras plataformas", () => {
    expect(pickWhatsAppTarget({ phone: null, links: [{ channelId: IG.id, senderId: "123" }] }, [WA])).toBeNull();
  });
});
