// Archivo adjunto de las respuestas guardadas (revisión A-2): solo el servidor
// escribe attachment_*, la ruta debe ser de este espacio, y nunca se borra un
// archivo de un chat. getWorkspace, el almacenamiento y los clientes van
// simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { conversationMediaPath, replyMediaPath } from "@/lib/chat-media";

const state = vi.hoisted(() => ({
  userDb: null as unknown,
  serviceDb: null as unknown,
  userId: "",
  workspaceId: "",
  removed: [] as string[],
  stored: {} as Record<string, { size: number; mime: string }>,
}));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: "member",
    supabase: state.userDb,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.serviceDb,
  createClient: async () => state.userDb,
}));
vi.mock("@/lib/media-store", () => ({
  createUploadUrl: async () => ({ path: "x", token: "t" }),
  objectInfo: async (_db: unknown, path: string) => state.stored[path] ?? null,
  removeObjects: async (_db: unknown, paths: string[]) => {
    state.removed.push(...paths);
    return true;
  },
}));

import { createSavedReply, deleteSavedReply, updateSavedReply } from "./saved-replies";

const WS = randomUUID();
const OTHER_WS = randomUUID();
const ANA = randomUUID();

let fake: FakeDb;

/** Imita el trigger de 00031: con sesión de usuario no se escriben columnas attachment_*. */
function userClientLike(db: FakeDb) {
  const guard = (payload: unknown) => {
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const r of rows as Array<Record<string, unknown>>) {
      for (const key of ["attachment_url", "attachment_name", "attachment_mime", "attachment_size"]) {
        if (r && r[key] !== undefined && r[key] !== null) throw new Error("saved_reply_attachment_server_only");
      }
    }
  };
  return {
    from(table: string) {
      const q = db.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return new Proxy(q, {
        get(target, prop: string) {
          if (table === "saved_replies" && (prop === "insert" || prop === "update")) {
            return (payload: unknown) => {
              guard(payload);
              return target[prop](payload);
            };
          }
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
  };
}

beforeEach(() => {
  fake = new FakeDb();
  state.serviceDb = fake;
  state.userDb = userClientLike(fake);
  state.userId = ANA;
  state.workspaceId = WS;
  state.removed = [];
  state.stored = {};
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [{ workspace_id: WS, user_id: ANA, role: "member" }]);
});

describe("createSavedReply con archivo", () => {
  it("crea la fila sin archivo con el usuario y registra el adjunto con el servidor", async () => {
    const path = replyMediaPath(WS, "image/png");
    state.stored[path] = { size: 1000, mime: "image/png" };
    const res = await createSavedReply({
      scope: "personal",
      title: "Con foto",
      shortcut: null,
      body: "hola",
      caseTypeId: null,
      attachment: { path, name: "foto.png" },
    });
    expect("error" in res).toBe(false);
    const rows = fake.rows("saved_replies");
    expect(rows).toHaveLength(1);
    expect(rows[0].attachment_url).toBe(path);
    expect(rows[0].attachment_mime).toBe("image/png");
  });

  it("rechaza una ruta de un chat o de otro espacio", async () => {
    const convPath = conversationMediaPath(WS, randomUUID(), "in", "image/png");
    const foreign = replyMediaPath(OTHER_WS, "image/png");
    for (const path of [convPath, foreign]) {
      state.stored[path] = { size: 1000, mime: "image/png" };
      const res = await createSavedReply({
        scope: "personal",
        title: "Robo",
        shortcut: null,
        body: "x",
        caseTypeId: null,
        attachment: { path, name: "x.png" },
      });
      expect(res).toEqual({ error: "El archivo no es válido." });
    }
    expect(fake.rows("saved_replies")).toHaveLength(0);
  });

  it("rechaza un archivo que ya usa otra respuesta", async () => {
    const path = replyMediaPath(WS, "image/png");
    state.stored[path] = { size: 1000, mime: "image/png" };
    fake.seed("saved_replies", [
      { workspace_id: WS, scope: "workspace", title: "Otra", body: "x", attachment_url: path },
    ]);
    const res = await createSavedReply({
      scope: "personal",
      title: "Copia",
      shortcut: null,
      body: "x",
      caseTypeId: null,
      attachment: { path, name: "x.png" },
    });
    expect(res).toEqual({ error: "El archivo no es válido." });
  });
});

describe("borrar y reemplazar el archivo", () => {
  it("borrar la respuesta borra su archivo de respuestas", async () => {
    const path = replyMediaPath(WS, "image/png");
    const [reply] = fake.seed("saved_replies", [
      { workspace_id: WS, scope: "personal", user_id: ANA, title: "R", body: "x", attachment_url: path },
    ]);
    const res = await deleteSavedReply(reply.id as string);
    expect(res).toEqual({ ok: true });
    expect(state.removed).toEqual([path]);
  });

  it("nunca borra un archivo de un chat aunque la fila lo tenga como adjunto", async () => {
    const chatFile = conversationMediaPath(WS, randomUUID(), "in", "image/png");
    const [reply] = fake.seed("saved_replies", [
      { workspace_id: WS, scope: "personal", user_id: ANA, title: "R", body: "x", attachment_url: chatFile },
    ]);
    const res = await deleteSavedReply(reply.id as string);
    expect(res).toEqual({ ok: true });
    expect(state.removed).toEqual([]);
  });

  it("no borra el archivo si otra respuesta todavía lo usa", async () => {
    const path = replyMediaPath(WS, "image/png");
    const [reply] = fake.seed("saved_replies", [
      { workspace_id: WS, scope: "personal", user_id: ANA, title: "R", body: "x", attachment_url: path },
      { workspace_id: WS, scope: "workspace", title: "Otra", body: "x", attachment_url: path },
    ]);
    await deleteSavedReply(reply.id as string);
    expect(state.removed).toEqual([]);
  });

  it("reemplazar el archivo registra el nuevo con el servidor y borra el anterior", async () => {
    const oldPath = replyMediaPath(WS, "image/png");
    const newPath = replyMediaPath(WS, "image/png");
    state.stored[newPath] = { size: 500, mime: "image/png" };
    const [reply] = fake.seed("saved_replies", [
      { workspace_id: WS, scope: "personal", user_id: ANA, title: "R", body: "x", attachment_url: oldPath },
    ]);
    const res = await updateSavedReply(reply.id as string, {
      title: "R",
      shortcut: null,
      body: "x",
      caseTypeId: null,
      attachment: { path: newPath, name: "nuevo.png" },
    });
    expect("error" in res).toBe(false);
    expect(fake.rows("saved_replies")[0].attachment_url).toBe(newPath);
    expect(state.removed).toEqual([oldPath]);
  });
});
