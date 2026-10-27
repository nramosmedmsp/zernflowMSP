import { describe, expect, it } from "vitest";
import { clearUserDrafts, draftConversationIds, readDraft, writeDraft, DRAFT_TTL_MS, type DraftStorage } from "./drafts";

class MemoryStorage implements DraftStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const ana = { userId: "ana", workspaceId: "ws-1" };
const luis = { userId: "luis", workspaceId: "ws-1" };

describe("borradores", () => {
  it("se guardan por chat y modo, y nunca aparecen en otro chat", () => {
    const s = new MemoryStorage();
    writeDraft(s, ana, "conv-a", "message", "Hola Patricia");
    writeDraft(s, ana, "conv-a", "note", "Revisar stock");
    expect(readDraft(s, ana, "conv-a", "message")).toBe("Hola Patricia");
    expect(readDraft(s, ana, "conv-a", "note")).toBe("Revisar stock");
    expect(readDraft(s, ana, "conv-b", "message")).toBe("");
  });

  it("son de cada persona aunque compartan la PC", () => {
    const s = new MemoryStorage();
    writeDraft(s, ana, "conv-a", "message", "de Ana");
    expect(readDraft(s, luis, "conv-a", "message")).toBe("");
  });

  it("vencen a los 7 días y un texto vacío borra el borrador", () => {
    const s = new MemoryStorage();
    writeDraft(s, ana, "conv-a", "message", "viejo", 0);
    expect(readDraft(s, ana, "conv-a", "message", DRAFT_TTL_MS + 1)).toBe("");
    writeDraft(s, ana, "conv-a", "message", "nuevo");
    writeDraft(s, ana, "conv-a", "message", "   ");
    expect(readDraft(s, ana, "conv-a", "message")).toBe("");
  });

  it("lista los chats con borrador de mensaje y se borran al cerrar sesión", () => {
    const s = new MemoryStorage();
    writeDraft(s, ana, "conv-a", "message", "Hola");
    writeDraft(s, ana, "conv-b", "note", "solo nota");
    writeDraft(s, luis, "conv-c", "message", "de Luis");
    expect([...draftConversationIds(s, ana).entries()]).toEqual([["conv-a", "Hola"]]);
    clearUserDrafts(s, "ana");
    expect(draftConversationIds(s, ana).size).toBe(0);
    expect(readDraft(s, luis, "conv-c", "message")).toBe("de Luis");
  });

  it("si el almacenamiento falla, la caja sigue funcionando", () => {
    const broken: DraftStorage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {},
    };
    expect(readDraft(broken, ana, "conv-a", "message")).toBe("");
    expect(() => writeDraft(broken, ana, "conv-a", "message", "x")).not.toThrow();
    expect(readDraft(null, ana, "conv-a", "message")).toBe("");
  });
});
