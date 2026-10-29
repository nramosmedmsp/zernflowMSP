// B-23: la ruta que envía una difusión. Solo un administrador puede, y un
// segundo envío (doble clic, otro administrador) no repite la promoción.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, admin: true }));

vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: async () =>
    state.admin
      ? { ok: true, ctx: { supabase: state.db, user: { id: "u1" }, workspaceId: "ws-1", role: "admin" } }
      : { ok: false, response: NextResponse.json({ error: "Solo administradores" }, { status: 403 }) },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));

import { POST } from "./route";

const PROMO = { kind: "template", template_name: "promo", language: "es", params: ["{nombre}"] };
let fake: FakeDb;
let broadcastId: string;

const call = () =>
  POST(new NextRequest("http://x/api/v1/broadcasts/b/send", { method: "POST", body: "{}" }), {
    params: Promise.resolve({ broadcastId }),
  });

beforeEach(() => {
  fake = new FakeDb();
  fake.unique("broadcast_recipients", ["broadcast_id", "contact_id"]);
  state.db = fake;
  state.admin = true;
  fake.seed("workspaces", [{ id: "ws-1", name: "Muscle Shop" }]);
  fake.seed("channels", [{ id: "ch", workspace_id: "ws-1", platform: "whatsapp", is_active: true }]);
  fake.seed("contacts", [
    { id: "c1", workspace_id: "ws-1", display_name: "Ana", phone: "+51 987 654 321", is_subscribed: true },
  ]);
  const [b] = fake.seed("broadcasts", [
    { workspace_id: "ws-1", name: "Promo", status: "draft", message_content: PROMO, total_recipients: 0 },
  ]);
  broadcastId = b.id as string;
});

describe("POST /api/v1/broadcasts/:id/send", () => {
  it("quien no es administrador recibe 403 y no se programa nada", async () => {
    state.admin = false;
    const res = await call();
    expect(res.status).toBe(403);
    expect(fake.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("un administrador la envía: un destinatario y un trabajo por contacto", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ broadcastId, totalRecipients: 1, status: "sending" });
    expect(fake.rows("scheduled_jobs")).toHaveLength(1);
  });

  it("enviar otra vez la misma difusión no repite los envíos", async () => {
    expect((await call()).status).toBe(200);
    const second = await call();
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(fake.rows("broadcast_recipients")).toHaveLength(1);
    expect(fake.rows("scheduled_jobs")).toHaveLength(1);
  });

  it("una difusión que no existe responde 404", async () => {
    broadcastId = "no-existe";
    expect((await call()).status).toBe(404);
  });
});
