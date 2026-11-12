// SEG-13 (nada interno hacia el navegador) y SEG-05 (acciones sensibles en la actividad)
// en las rutas de administración de canales, flujos y difusiones.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({
  db: null as unknown,
  zernioDelete: null as unknown as () => Promise<unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.db,
  createServiceClient: async () => state.db,
  createRawServiceClient: () => ({ rpc: async () => ({ data: [{ allowed: true, current_hits: 1, retry_after_seconds: 1 }], error: null }) }),
}));
vi.mock("@/lib/api-auth", () => {
  const guard = () => ({ ok: true, ctx: { supabase: state.db, user: { id: "admin-1" }, workspaceId: "ws-1", role: "admin" } });
  return { requireApiAdmin: async () => guard(), requireApiMember: async () => guard() };
});
vi.mock("@/lib/workspace-secrets", () => ({ getLateApiKey: async () => "zk_clave_secreta" }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ accounts: { deleteAccount: () => state.zernioDelete() } }),
}));

import { GET as channelsGet } from "./channels/route";
import { DELETE as channelDelete, PATCH as channelPatch } from "./channels/[channelId]/route";
import { GET as flowsGet, POST as flowsPost } from "./flows/route";
import { DELETE as flowDelete, PUT as flowPut } from "./flows/[flowId]/route";
import { GET as broadcastsGet, POST as broadcastsPost } from "./broadcasts/route";

const ctx = (id: string) => ({ params: Promise.resolve({ channelId: id, flowId: id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest("https://app.test/api/x", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });

let fake: FakeDb;
beforeEach(() => {
  fake = new FakeDb();
  state.db = fake;
  state.zernioDelete = async () => ({ data: {}, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.seed("channels", [{ id: "ch-1", workspace_id: "ws-1", platform: "whatsapp", late_account_id: "acc-1", is_active: true }]);
  fake.seed("flows", [{ id: "fl-1", workspace_id: "ws-1", name: "Bienvenida", status: "draft" }]);
});

const audits = () => fake.rows("activity").map((a) => a.meta as Record<string, unknown>);
const leaks = (text: string) => /fallo simulado|42P01|relation|zk_clave|Cannot|ECONN|supabase|postgres/i.test(text);

describe("SEG-13: errores internos no llegan al navegador", () => {
  it("canales: la lista, el borrado y el cambio responden con texto genérico en español", async () => {
    fake.failNext.set("channels", "select");
    let res = await channelsGet();
    expect(res.status).toBe(500);
    let text = await res.text();
    expect(leaks(text)).toBe(false);
    expect(JSON.parse(text).error).toMatch(/canales/);

    fake.failNext.set("channels", "delete");
    res = await channelDelete(req("DELETE"), ctx("ch-1"));
    text = await res.text();
    expect(res.status).toBe(500);
    expect(leaks(text)).toBe(false);

    fake.failNext.set("channels", "update");
    res = await channelPatch(req("PATCH", { is_active: false }), ctx("ch-1"));
    text = await res.text();
    expect(res.status).toBe(500);
    expect(leaks(text)).toBe(false);
  });

  it("si Zernio rechaza desconectar, no se muestra su respuesta (puede traer datos internos)", async () => {
    state.zernioDelete = async () => ({ error: { message: "token zk_clave_secreta inválido", trace: "stack..." }, response: { status: 500 } });
    const res = await channelDelete(req("DELETE"), ctx("ch-1"));
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(leaks(text)).toBe(false);
    expect(JSON.parse(text).error).toMatch(/desconectar/);
    // El canal sigue y no se registró ningún borrado.
    expect(fake.rows("channels")).toHaveLength(1);
    expect(audits()).toHaveLength(0);
  });

  it("si Zernio lanza una excepción, tampoco", async () => {
    state.zernioDelete = async () => {
      throw new Error("ECONNRESET 10.0.0.5:443");
    };
    const res = await channelDelete(req("DELETE"), ctx("ch-1"));
    expect(leaks(await res.text())).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("flujos y difusiones: listar, crear, guardar y borrar", async () => {
    const cases: Array<[string, string, () => Promise<Response>]> = [
      ["flows", "select", () => flowsGet()],
      ["flows", "insert", () => flowsPost(req("POST", { name: "Nuevo" }))],
      ["flows", "update", () => flowPut(req("PUT", { name: "X" }), ctx("fl-1"))],
      ["flows", "delete", () => flowDelete(req("DELETE"), ctx("fl-1"))],
      ["broadcasts", "select", () => broadcastsGet()],
      ["broadcasts", "insert", () => broadcastsPost(req("POST", { name: "Promo" }))],
    ];
    for (const [table, op, call] of cases) {
      fake.failNext.set(table, op);
      const res = await call();
      const text = await res.text();
      expect(res.status, `${table} ${op}`).toBe(500);
      expect(leaks(text), `${table} ${op}: ${text}`).toBe(false);
      expect(JSON.parse(text).error).toMatch(/Inténtalo de nuevo/);
    }
  });
});

describe("SEG-05: acciones sensibles de canales y flujos quedan registradas", () => {
  it("borrar un canal deja quién y cuál", async () => {
    const res = await channelDelete(req("DELETE"), ctx("ch-1"));
    expect(res.status).toBe(200);
    expect(fake.rows("channels")).toHaveLength(0);
    expect(fake.rows("activity")).toHaveLength(1);
    expect(fake.rows("activity")[0]).toMatchObject({
      type: "config_changed",
      actor_id: "admin-1",
      workspace_id: "ws-1",
      meta: { action: "channel_deleted", entity: "channel", channel_id: "ch-1" },
    });
  });

  it("encender o apagar un canal deja registro", async () => {
    await channelPatch(req("PATCH", { is_active: false }), ctx("ch-1"));
    expect(fake.rows("activity")[0]).toMatchObject({ to_value: "off", meta: { action: "channel_toggled", channel_id: "ch-1" } });
  });

  it("borrar un flujo deja registro", async () => {
    await flowDelete(req("DELETE"), ctx("fl-1"));
    expect(audits()).toEqual([expect.objectContaining({ action: "flow_deleted", entity: "flow", flow_id: "fl-1" })]);
  });

  it("si el borrado falla no se registra nada", async () => {
    fake.failNext.set("channels", "delete");
    await channelDelete(req("DELETE"), ctx("ch-1"));
    expect(fake.rows("activity")).toHaveLength(0);
  });
});
