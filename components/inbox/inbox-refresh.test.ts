import { describe, expect, it } from "vitest";
import type { InboxCase, InboxConversation } from "./inbox-model";
import { dropHiddenConversations, lostContactIds, replaceActiveCases } from "./inbox-refresh";

const kase = (id: string, contactId: string) => ({ id, contact_id: contactId }) as InboxCase;
const chat = (id: string, contactId: string) => ({ id, contact_id: contactId }) as InboxConversation;

describe("M-19: reasignar una gestión a otro asesor", () => {
  it("detecta los contactos que ya no tienen gestiones visibles", () => {
    const before = [kase("k1", "ana"), kase("k2", "ana"), kase("k3", "luis")];
    const after = [kase("k2", "ana")];
    expect(lostContactIds(before, after)).toEqual(["luis"]);
    expect(lostContactIds(before, before)).toEqual([]);
    expect(lostContactIds([], after)).toEqual([]);
  });

  it("quita el chat del contacto que se reasignó si la base ya no se lo muestra", () => {
    const chats = [chat("c-ana", "ana"), chat("c-luis", "luis")];
    expect(dropHiddenConversations(chats, ["luis"], new Set()).map((c) => c.id)).toEqual(["c-ana"]);
  });

  it("conserva el chat si la base todavía se lo entrega (por ejemplo, otra gestión suya)", () => {
    const chats = [chat("c-ana", "ana"), chat("c-luis", "luis")];
    expect(dropHiddenConversations(chats, ["luis"], new Set(["c-luis"])).map((c) => c.id)).toEqual(["c-ana", "c-luis"]);
  });

  it("las gestiones que llegan de la base reemplazan a las de pantalla", () => {
    const fresh = [kase("k2", "ana")];
    expect(replaceActiveCases(fresh)).toEqual(fresh);
    expect(replaceActiveCases(fresh)).not.toBe(fresh);
  });
});
