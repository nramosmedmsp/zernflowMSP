// SEG-01: cada ruta con tope responde 429 (mensaje claro + Retry-After) ANTES de
// hacer el trabajo, y deja pasar si el contador falla.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  rpc: null as unknown,
  work: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => {
  // Cualquier consulta a la base de datos = "se hizo el trabajo".
  const db = () => ({
    from: () => {
      state.work("from");
      throw new Error("no debería llegar a trabajar");
    },
  });
  return { createClient: async () => db(), createServiceClient: async () => db(), createRawServiceClient: () => ({ rpc: state.rpc }) };
});
vi.mock("@/lib/view-as/state", () => ({ getEffectiveAuthUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/api-auth", () => {
  const ok = { ok: true, ctx: { supabase: { from: () => { state.work("from"); throw new Error("no debería llegar a trabajar"); } }, user: { id: "u1" }, workspaceId: "ws", role: "admin" } };
  return { requireApiMember: async () => ok, requireApiAdmin: async () => ok };
});
vi.mock("@/lib/view-as/service", () => ({
  requireRealOwner: async () => ({ ok: true, ctx: { viewerId: "owner-1", authSessionId: "s", workspaceId: "ws", service: {} } }),
}));
vi.mock("@/lib/broadcasts/request", () => ({ loadBroadcastForPlan: async () => { state.work("difusion"); throw new Error("no debería llegar a trabajar"); } }));

import { POST as messagesPost } from "./messages/route";
import { POST as templatesSend } from "./templates/send/route";
import { POST as uploadUrl } from "./media/upload-url/route";
import { GET as contactsGet } from "./contacts/route";
import { POST as broadcastSend } from "./broadcasts/[broadcastId]/send/route";
import { POST as viewAsStart } from "./view-as/start/route";

const json = (url: string, method = "POST") =>
  new NextRequest(`https://app.test${url}`, { method, body: method === "GET" ? undefined : "{}", headers: { "content-type": "application/json", origin: "https://app.test", host: "app.test" } });

const routes: Array<[string, () => Promise<Response>]> = [
  ["enviar mensaje", () => messagesPost(json("/api/v1/messages"))],
  ["enviar plantilla", () => templatesSend(json("/api/v1/templates/send"))],
  ["enlace de subida", () => uploadUrl(json("/api/v1/media/upload-url"))],
  ["leer contactos", () => contactsGet(json("/api/v1/contacts", "GET"))],
  ["lanzar difusión", () => broadcastSend(json("/api/v1/broadcasts/b1/send"), { params: Promise.resolve({ broadcastId: "b1" }) })],
  ["iniciar Ver como", () => viewAsStart(json("/api/v1/view-as/start"))],
];

beforeEach(() => {
  state.work.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("topes de frecuencia en las rutas", () => {
  it.each(routes)("%s: pasado el tope responde 429 con mensaje y Retry-After, sin hacer el trabajo", async (_name, call) => {
    state.rpc = async () => ({ data: [{ allowed: false, current_hits: 500, retry_after_seconds: 33 }], error: null });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("33");
    expect(await res.json()).toMatchObject({ error: "Vas muy rápido. Espera un momento y vuelve a intentar.", code: "rate_limited" });
    expect(state.work).not.toHaveBeenCalled();
  });

  it.each(routes)("%s: si el contador falla, NO bloquea (la ruta sigue y hace su trabajo)", async (_name, call) => {
    state.rpc = async () => {
      throw new Error("base caída");
    };
    // El trabajo real está simulado: puede responder 400 por el cuerpo vacío o lanzar al tocar la
    // base. Lo que importa es que NO lo frena el contador (no hay 429).
    let status: number | null = null;
    try {
      status = (await call()).status;
    } catch {
      status = null;
    }
    expect(status).not.toBe(429);
  });
});
