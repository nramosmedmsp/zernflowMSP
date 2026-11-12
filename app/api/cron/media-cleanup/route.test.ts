// SEG-10 / SEG-01: la limpieza diaria también borra las subidas que nadie envió
// y poda los contadores de frecuencia, sin tocar archivos de mensajes ni de respuestas.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));

import { GET } from "./route";

const WS = "11111111-1111-4111-8111-111111111111";
const CHAT = "33333333-3333-4333-8333-333333333333";
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const original = process.env.CRON_SECRET;
let fake: FakeDb;
let removed: string[];

function withBucket(db: FakeDb) {
  return Object.assign(Object.create(db), {
    from: (t: string) => db.from(t),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  });
}

const get = (headers: Record<string, string> = { authorization: "Bearer secreto" }) =>
  GET(new NextRequest("http://x/api/cron/media-cleanup", { headers }));

beforeEach(() => {
  process.env.CRON_SECRET = "secreto";
  fake = new FakeDb();
  removed = [];
  state.db = withBucket(fake);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/media-cleanup", () => {
  it("sin la clave responde 401 y no borra nada", async () => {
    fake.seed("media_uploads", [{ path: `${WS}/replies/${uuid(1)}.pdf`, workspace_id: WS, user_id: "u", source: "reply", created_at: ago(9 * DAY), used_at: null }]);
    expect((await get({})).status).toBe(401);
    expect(removed).toEqual([]);
    expect(fake.rows("media_uploads")).toHaveLength(1);
  });

  it("borra la subida que nadie envió, conserva la de un mensaje enviado y la de una respuesta guardada", async () => {
    const orphan = `${WS}/conv/${CHAT}/out/${uuid(1)}.jpg`;
    const sent = `${WS}/conv/${CHAT}/out/${uuid(2)}.jpg`;
    const savedReply = `${WS}/replies/${uuid(3)}.pdf`;
    const recent = `${WS}/conv/${CHAT}/out/${uuid(4)}.jpg`;
    fake.seed("media_uploads", [
      { path: orphan, workspace_id: WS, user_id: "u", source: "chat", created_at: ago(3 * DAY), used_at: null },
      { path: sent, workspace_id: WS, user_id: "u", source: "chat", created_at: ago(3 * DAY), used_at: null },
      { path: savedReply, workspace_id: WS, user_id: "u", source: "reply", created_at: ago(60 * DAY), used_at: null },
      { path: recent, workspace_id: WS, user_id: "u", source: "chat", created_at: ago(2 * 3600_000), used_at: null },
    ]);
    fake.seed("message_media", [
      { workspace_id: WS, conversation_id: CHAT, platform_message_id: "wamid.1", attachment_index: 0, direction: "outbound", storage_path: sent, status: "stored", created_at: ago(3 * DAY) },
    ]);
    fake.seed("saved_replies", [{ id: "r1", workspace_id: WS, title: "Precios", attachment_url: savedReply }]);

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, orphanUploadsRemoved: 1 });
    expect(removed).toEqual([orphan]);
    // Lo enviado, lo guardado y lo reciente siguen ahí.
    expect(fake.rows("media_uploads").map((r) => r.path).sort()).toEqual([sent, savedReply, recent].sort());
    expect(fake.rows("saved_replies")).toHaveLength(1);
    expect(fake.rows("message_media")[0].storage_path).toBe(sent);
  });

  it("sigue haciendo la limpieza de 2 meses de los chats", async () => {
    const old = `${WS}/conv/${CHAT}/in/${uuid(9)}.jpg`;
    fake.seed("message_media", [
      { id: "m1", workspace_id: WS, conversation_id: CHAT, platform_message_id: "w", attachment_index: 0, direction: "inbound", storage_path: old, status: "stored", created_at: ago(70 * DAY) },
    ]);
    const res = await get();
    expect(await res.json()).toMatchObject({ expired: 1 });
    expect(removed).toEqual([old]);
    expect(fake.rows("message_media")[0]).toMatchObject({ status: "expired", storage_path: null });
  });

  it("poda los contadores de frecuencia de más de un día y conserva los recientes", async () => {
    fake.seed("rate_limit_hits", [
      { bucket: "message_send:60:u1", window_start: ago(3 * DAY), hits: 4 },
      { bucket: "message_send:60:u1", window_start: ago(60_000), hits: 2 },
    ]);
    await get();
    expect(fake.rows("rate_limit_hits")).toHaveLength(1);
    expect(fake.rows("rate_limit_hits")[0].hits).toBe(2);
  });

  it("si la limpieza de subidas falla, la tarea principal igual termina bien", async () => {
    fake.seed("media_uploads", [{ path: `${WS}/replies/${uuid(1)}.pdf`, workspace_id: WS, user_id: "u", source: "reply", created_at: ago(9 * DAY), used_at: null }]);
    fake.failNext.set("media_uploads", "select");
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, orphanUploadsRemoved: 0 });
    expect(fake.rows("cron_runs")[0]).toMatchObject({ name: "media_cleanup" });
    expect(fake.rows("cron_runs")[0].last_ok_at).toBeTruthy();
  });
});
