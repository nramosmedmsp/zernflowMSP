// SEG-05: «Probar clave» solo deja registro cuando la clave de Zernio realmente se guarda y cambia.
// Solo probarla (sin espacio) o guardar la misma que ya estaba no escribe nada en la actividad.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  db: null as unknown,
  role: "owner" as string,
  stored: null as string | null,
  saved: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.db,
  createServiceClient: async () => state.db,
}));
vi.mock("@/lib/api-auth", () => ({
  WORKSPACE_CHANGED_MESSAGE: "El espacio de trabajo cambió.",
  requireApiAdmin: async () => ({ ok: true, ctx: { supabase: state.db, user: { id: "owner-1" }, workspaceId: "ws-1", role: state.role } }),
}));
vi.mock("@/lib/workspace-secrets", () => ({
  getLateApiKey: async () => state.stored,
  saveWorkspaceSecrets: async (_ws: string, patch: { lateApiKey?: string }) => {
    if (patch.lateApiKey) state.saved.push(patch.lateApiKey);
    return { error: null };
  },
}));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { listAccounts: async () => ({ data: { accounts: [] } }) } }),
}));
vi.mock("@/lib/zernio-webhook", () => ({
  getOrCreateWorkspaceWebhookSecret: async () => "secreto-webhook",
  ensureWebhookRegistered: async () => undefined,
}));
vi.mock("@/lib/inbox-sync", () => ({ backfillInboxConversations: async () => undefined }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new NextRequest("https://app.test/api/v1/channels/test-key", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

let fake: FakeDb;
const audits = () => fake.rows("activity").filter((a) => (a.meta as { action?: string }).action === "api_key_changed");

beforeEach(() => {
  fake = new FakeDb();
  state.db = fake;
  state.role = "owner";
  state.stored = null;
  state.saved = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("probar la clave de Zernio vs guardarla", () => {
  it("solo probarla (sin guardar) no deja ninguna fila", async () => {
    const res = await post({ apiKey: "zk_PRUEBA_SECRETA" });
    expect(res.status).toBe(200);
    expect(state.saved).toEqual([]);
    expect(audits()).toHaveLength(0);
  });

  it("guardar una clave nueva deja una fila, sin el valor de la clave", async () => {
    const res = await post({ apiKey: "zk_NUEVA_SECRETA", workspaceId: "ws-1" });
    expect(res.status).toBe(200);
    expect(state.saved).toEqual(["zk_NUEVA_SECRETA"]);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ type: "config_changed", actor_id: "owner-1", meta: { action: "api_key_changed", entity: "secrets", zernio: true } });
    expect(JSON.stringify(fake.rows("activity"))).not.toMatch(/SECRETA/);
  });

  it("volver a guardar la misma clave que ya estaba no es un cambio", async () => {
    state.stored = "zk_MISMA";
    await post({ apiKey: " zk_MISMA ", workspaceId: "ws-1" });
    expect(audits()).toHaveLength(0);
  });

  it("cambiar a otra clave sí deja fila", async () => {
    state.stored = "zk_VIEJA";
    await post({ apiKey: "zk_OTRA", workspaceId: "ws-1" });
    expect(audits()).toHaveLength(1);
    expect(audits()[0].meta).toMatchObject({ first_time: false });
  });

  it("un Administrador no puede guardar y no queda fila", async () => {
    state.role = "admin";
    const res = await post({ apiKey: "zk_X", workspaceId: "ws-1" });
    expect(res.status).toBe(403);
    expect(state.saved).toEqual([]);
    expect(audits()).toHaveLength(0);
  });
});
