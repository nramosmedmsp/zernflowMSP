import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import {
  ORPHAN_UPLOAD_AGE_MS,
  PENDING_UPLOADS_MAX,
  cleanOrphanUploads,
  isOwnedUploadPath,
  markUploadsUsed,
  registerUpload,
} from "./upload-tracking";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const chatPath = (n: number, ws = WS) => `${ws}/conv/${CHAT}/out/${uuid(n)}.jpg`;
const replyPath = (n: number, ws = WS) => `${ws}/replies/${uuid(n)}.pdf`;

const NOW = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3600_000;

let fake: FakeDb;
let removed: string[];
let storageFails: boolean;
/** La base falsa más el bucket falso (lo único que usa removeObjects). */
function db() {
  return Object.assign(Object.create(fake), {
    from: (t: string) => fake.from(t),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (storageFails) return { error: { message: "storage caído" } };
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }) as never;
}

beforeEach(() => {
  fake = new FakeDb();
  fake.unique("media_uploads", ["path"]);
  removed = [];
  storageFails = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const seedUpload = (path: string, ageMs: number, extra: Record<string, unknown> = {}) =>
  fake.seed("media_uploads", [
    { path, workspace_id: WS, user_id: "u1", source: path.includes("/replies/") ? "reply" : "chat", created_at: ago(ageMs), used_at: null, ...extra },
  ]);

describe("registerUpload: tope de subidas sin enviar", () => {
  it("anota la subida", async () => {
    expect(await registerUpload(db(), { workspaceId: WS, userId: "u1", path: chatPath(1), source: "chat" }, NOW)).toEqual({ ok: true });
    expect(fake.rows("media_uploads")).toHaveLength(1);
    expect(fake.rows("media_uploads")[0]).toMatchObject({ path: chatPath(1), user_id: "u1", workspace_id: WS, source: "chat" });
  });

  it("al llegar al tope pide enviar o esperar, y no anota la nueva", async () => {
    for (let i = 0; i < PENDING_UPLOADS_MAX; i++) seedUpload(chatPath(i), HOUR);
    const res = await registerUpload(db(), { workspaceId: WS, userId: "u1", path: chatPath(999), source: "chat" }, NOW);
    expect(res).toEqual({ ok: false, reason: "too_many_pending" });
    expect(fake.rows("media_uploads")).toHaveLength(PENDING_UPLOADS_MAX);
  });

  it("las subidas ya usadas, las de otro usuario y las de hace más de un día no cuentan", async () => {
    for (let i = 0; i < PENDING_UPLOADS_MAX; i++) {
      if (i % 3 === 0) seedUpload(chatPath(i), HOUR, { used_at: ago(HOUR) });
      else if (i % 3 === 1) seedUpload(chatPath(i), HOUR, { user_id: "otra-persona" });
      else seedUpload(chatPath(i), 30 * HOUR);
    }
    expect(await registerUpload(db(), { workspaceId: WS, userId: "u1", path: chatPath(500), source: "chat" }, NOW)).toEqual({ ok: true });
  });

  it("si el registro falla NO bloquea el trabajo", async () => {
    const broken = { from: () => { throw new Error("tabla inexistente"); } } as never;
    expect(await registerUpload(broken, { workspaceId: WS, userId: "u1", path: chatPath(1), source: "chat" }, NOW)).toEqual({ ok: true });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("markUploadsUsed", () => {
  it("marca solo las rutas indicadas", async () => {
    seedUpload(chatPath(1), HOUR);
    seedUpload(chatPath(2), HOUR);
    await markUploadsUsed(db(), [chatPath(1)], NOW);
    const [a, b] = fake.rows("media_uploads");
    expect(a.used_at).toBe(NOW.toISOString());
    expect(b.used_at).toBeNull();
  });
});

describe("isOwnedUploadPath", () => {
  it("solo acepta la forma exacta de una subida nuestra del mismo espacio", () => {
    expect(isOwnedUploadPath(chatPath(1), WS, "chat")).toBe(true);
    expect(isOwnedUploadPath(replyPath(1), WS, "reply")).toBe(true);
    expect(isOwnedUploadPath(chatPath(1, OTHER_WS), WS, "chat")).toBe(false); // otro espacio
    expect(isOwnedUploadPath(`${WS}/conv/${CHAT}/in/${uuid(1)}.jpg`, WS, "chat")).toBe(false); // archivo ENTRANTE
    expect(isOwnedUploadPath(replyPath(1), WS, "chat")).toBe(false); // tipo cruzado
    expect(isOwnedUploadPath(chatPath(1), WS, "reply")).toBe(false);
    expect(isOwnedUploadPath("../otra/cosa.jpg", WS, "chat")).toBe(false);
    expect(isOwnedUploadPath(`${WS}/conv/${CHAT}/out/../in/x.jpg`, WS, "chat")).toBe(false);
  });
});

describe("cleanOrphanUploads: limpieza de lo que nunca se envió", () => {
  it("borra del bucket lo subido hace más de 48 h que nadie usó, y su registro", async () => {
    seedUpload(chatPath(1), ORPHAN_UPLOAD_AGE_MS + HOUR);
    seedUpload(replyPath(2), ORPHAN_UPLOAD_AGE_MS + 5 * HOUR);
    const res = await cleanOrphanUploads(db(), NOW);
    expect(res).toMatchObject({ checked: 2, removed: 2, used: 0, failed: false });
    expect(removed.sort()).toEqual([chatPath(1), replyPath(2)].sort());
    expect(fake.rows("media_uploads")).toHaveLength(0);
  });

  it("NO toca lo reciente (todavía puede enviarse)", async () => {
    seedUpload(chatPath(1), ORPHAN_UPLOAD_AGE_MS - HOUR);
    seedUpload(chatPath(2), 2 * HOUR);
    const res = await cleanOrphanUploads(db(), NOW);
    expect(res).toMatchObject({ checked: 0, removed: 0 });
    expect(removed).toEqual([]);
    expect(fake.rows("media_uploads")).toHaveLength(2);
  });

  it("NO borra el archivo de un mensaje ya enviado, aunque la subida no se haya marcado como usada", async () => {
    const sentPath = chatPath(1);
    seedUpload(sentPath, 5 * 24 * HOUR);
    fake.seed("message_media", [
      { workspace_id: WS, conversation_id: CHAT, platform_message_id: "wamid.1", attachment_index: 0, direction: "outbound", storage_path: sentPath, status: "stored" },
    ]);
    const res = await cleanOrphanUploads(db(), NOW);
    expect(removed).toEqual([]);
    expect(res).toMatchObject({ checked: 1, used: 1, removed: 0 });
    // Queda marcada como usada: no se vuelve a revisar.
    expect(fake.rows("media_uploads")[0].used_at).toBe(NOW.toISOString());
  });

  it("NO borra el archivo de una respuesta guardada, aunque tenga meses", async () => {
    const kept = replyPath(1);
    seedUpload(kept, 90 * 24 * HOUR);
    fake.seed("saved_replies", [{ id: "r1", workspace_id: WS, title: "Hola", attachment_url: kept }]);
    await cleanOrphanUploads(db(), NOW);
    expect(removed).toEqual([]);
    expect(fake.rows("media_uploads")[0].used_at).toBe(NOW.toISOString());
  });

  it("en un mismo lote borra solo lo huérfano y respeta lo enviado y lo guardado", async () => {
    const sent = chatPath(1);
    const saved = replyPath(2);
    const orphanChat = chatPath(3);
    const orphanReply = replyPath(4);
    for (const p of [sent, saved, orphanChat, orphanReply]) seedUpload(p, 4 * 24 * HOUR);
    fake.seed("message_media", [{ workspace_id: WS, conversation_id: CHAT, platform_message_id: "w", attachment_index: 0, direction: "outbound", storage_path: sent, status: "stored" }]);
    fake.seed("saved_replies", [{ id: "r1", workspace_id: WS, title: "x", attachment_url: saved }]);
    const res = await cleanOrphanUploads(db(), NOW);
    expect(res).toMatchObject({ checked: 4, used: 2, removed: 2 });
    expect(removed.sort()).toEqual([orphanChat, orphanReply].sort());
    expect(removed).not.toContain(sent);
    expect(removed).not.toContain(saved);
  });

  it("no borra rutas raras (archivo entrante, otro espacio, escape de carpeta): solo olvida la fila", async () => {
    const weird = [
      `${WS}/conv/${CHAT}/in/${uuid(1)}.jpg`, // entrante: jamás se borra desde aquí
      chatPath(2, OTHER_WS), // la fila dice WS pero la ruta es de otro espacio
      `${WS}/conv/${CHAT}/out/../in/${uuid(3)}.jpg`,
      "cualquier/cosa.jpg",
    ];
    weird.forEach((p, i) => seedUpload(p, 5 * 24 * HOUR, { source: "chat", path: p }));
    const res = await cleanOrphanUploads(db(), NOW);
    expect(removed).toEqual([]);
    expect(res).toMatchObject({ checked: 4, skipped: 4, removed: 0 });
    expect(fake.rows("media_uploads")).toHaveLength(0);
  });

  it("si el almacenamiento falla no olvida las filas: se reintenta mañana", async () => {
    seedUpload(chatPath(1), 5 * 24 * HOUR);
    storageFails = true;
    const res = await cleanOrphanUploads(db(), NOW);
    expect(res).toMatchObject({ removed: 0, failed: true });
    expect(fake.rows("media_uploads")).toHaveLength(1);
    storageFails = false;
    expect(await cleanOrphanUploads(db(), NOW)).toMatchObject({ removed: 1, failed: false });
    expect(removed).toEqual([chatPath(1)]);
  });

  it("si no puede comprobar si se usaron, no borra nada", async () => {
    seedUpload(chatPath(1), 5 * 24 * HOUR);
    fake.failNext.set("message_media", "select");
    const res = await cleanOrphanUploads(db(), NOW);
    expect(removed).toEqual([]);
    expect(res).toMatchObject({ failed: true, removed: 0 });
    expect(fake.rows("media_uploads")).toHaveLength(1);
  });

  it("procesa varios lotes", async () => {
    for (let i = 0; i < 7; i++) seedUpload(chatPath(i), 5 * 24 * HOUR);
    const res = await cleanOrphanUploads(db(), NOW, { batch: 3 });
    expect(res).toMatchObject({ checked: 7, removed: 7 });
    expect(removed).toHaveLength(7);
  });
});
