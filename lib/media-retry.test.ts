// M-13: un archivo del cliente que no se pudo copiar una vez se vuelve a
// intentar al abrirlo (con límite), en vez de quedar "fallido" para siempre.

import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { attachMedia, type InboxMessage } from "./inbox-messages";
import { canRetryMedia, MAX_MEDIA_ATTEMPTS, storeInboundMedia } from "./media-store";

afterEach(() => vi.restoreAllMocks());

describe("canRetryMedia", () => {
  it("solo reintenta los fallidos y con límite de intentos", () => {
    expect(canRetryMedia({ status: "failed", fetch_attempts: 1 })).toBe(true);
    expect(canRetryMedia({ status: "failed" })).toBe(true);
    expect(canRetryMedia({ status: "failed", fetch_attempts: MAX_MEDIA_ATTEMPTS })).toBe(false);
    expect(canRetryMedia({ status: "stored", fetch_attempts: 1 })).toBe(false);
    expect(canRetryMedia({ status: "too_large", fetch_attempts: 1 })).toBe(false);
    expect(canRetryMedia({ status: "expired", fetch_attempts: 1 })).toBe(false);
  });
});

describe("la bandeja sigue ofreciendo el archivo fallido (para que el servidor lo reintente)", () => {
  it("una fila fallida con enlace de Zernio se muestra como remota, no como perdida", () => {
    const message = {
      id: "wamid.1",
      attachments: [{ type: "image", url: "https://media.zernio.com/api/v1/whatsapp/media/abc" }],
    } as unknown as InboxMessage;
    const [out] = attachMedia(
      [message],
      [{ id: "m1", platform_message_id: "wamid.1", attachment_index: 0, kind: "image", file_name: null, mime_type: null, size_bytes: null, status: "failed" }],
      { conversationId: "cv-1" },
    );
    expect(out.media?.[0]).toMatchObject({ status: "remote" });
    expect(out.media?.[0].url).toContain("/api/v1/media/remote?");
  });
});

describe("storeInboundMedia: reintento", () => {
  const service = (db: FakeDb) =>
    Object.assign(db.asDb(), {
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    });
  const params = {
    workspaceId: "ws-1",
    conversationId: "cv-1",
    platformMessageId: "wamid.1",
    attachments: [{ type: "image", url: "https://media.zernio.com/api/v1/whatsapp/media/abc" }],
    apiKey: "key",
  };

  it("el primer intento fallido queda registrado y el reintento lo reemplaza por la copia", async () => {
    const db = new FakeDb();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response("no listo", { status: 404 }));
    await storeInboundMedia(service(db), params);
    expect(db.rows("message_media")[0]).toMatchObject({ status: "failed", fetch_attempts: 1, storage_path: null });

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    await storeInboundMedia(service(db), { ...params, retryAttempt: 2 });
    expect(db.rows("message_media")).toHaveLength(1);
    expect(db.rows("message_media")[0]).toMatchObject({ status: "stored", fetch_attempts: 2, mime_type: "image/jpeg" });
    expect(db.rows("message_media")[0].storage_path).toBeTruthy();
  });

  it("un reintento que vuelve a fallar sube el contador", async () => {
    const db = new FakeDb();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 503 }));
    await storeInboundMedia(service(db), params);
    await storeInboundMedia(service(db), { ...params, retryAttempt: 2 });
    expect(db.rows("message_media")[0]).toMatchObject({ status: "failed", fetch_attempts: 2 });
  });
});
