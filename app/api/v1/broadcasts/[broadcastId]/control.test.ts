// Pausar, reanudar, cancelar y ver el avance: permiso en el servidor, candado de
// «Ver como» y respuestas en español.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { decideViewAsRequest } from "@/lib/view-as/guard";

const state = vi.hoisted(() => ({ db: null as unknown, role: "admin" as string | null, locked: false }));

vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: async () =>
    state.role === "owner" || state.role === "admin"
      ? { ok: true, ctx: { supabase: state.db, user: { id: "u1" }, workspaceId: "ws-1", role: state.role } }
      : { ok: false, response: NextResponse.json({ error: "Solo el Dueño o un Administrador pueden hacer esto." }, { status: 403 }) },
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db }));
vi.mock("@/lib/view-as/lock", () => ({ isViewAsLocked: async () => state.locked, markReadOnlyHit: async () => {} }));

import { POST as pause } from "./pause/route";
import { POST as resume } from "./resume/route";
import { POST as cancel } from "./cancel/route";
import { GET as progress } from "./progress/route";

let fake: FakeDb;
let id: string;

const call = (handler: typeof pause, broadcastId = id) =>
  handler(new NextRequest("http://x/api/v1/broadcasts/b/accion", { method: "POST" }), { params: Promise.resolve({ broadcastId }) });
const row = () => fake.rows("broadcasts").find((b) => b.id === id)!;

beforeEach(() => {
  fake = new FakeDb();
  state.db = fake;
  state.role = "admin";
  state.locked = false;
  const [b] = fake.seed("broadcasts", [{ workspace_id: "ws-1", name: "Promo", status: "sending", message_content: {}, consecutive_failures: 0 }]);
  id = b.id as string;
  fake.seed("broadcast_recipients", [
    { broadcast_id: id, contact_id: "c1", channel_id: "ch", status: "sent" },
    { broadcast_id: id, contact_id: "c2", channel_id: "ch", status: "pending" },
    { broadcast_id: id, contact_id: "c3", channel_id: "ch", status: "pending" },
  ]);
});

describe("permiso", () => {
  it.each([
    ["pausar", pause],
    ["reanudar", resume],
    ["cancelar", cancel],
  ])("quien no es Dueño ni Administrador no puede %s (403) y no cambia nada", async (_name, handler) => {
    row().status = _name === "reanudar" ? "paused" : "sending";
    const before = row().status;
    state.role = "member";
    const res = await call(handler);
    expect(res.status).toBe(403);
    expect(row().status).toBe(before);
    expect(fake.rows("broadcast_recipients").every((r) => r.status !== "cancelled")).toBe(true);
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("ver el avance también exige ser Dueño o Administrador", async () => {
    state.role = "member";
    const res = await progress(new NextRequest("http://x"), { params: Promise.resolve({ broadcastId: id }) });
    expect(res.status).toBe(403);
  });
});

describe("«Ver como» (solo lectura)", () => {
  it.each([
    ["pausar", pause],
    ["reanudar", resume],
    ["cancelar", cancel],
  ])("con una vista activa no se puede %s: 403 y no se escribe nada", async (_n, handler) => {
    state.locked = true;
    row().status = "paused";
    const res = await call(handler);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("solo lectura");
    expect(row().status).toBe("paused");
    expect(fake.rows("activity")).toHaveLength(0);
  });

  it("el candado del middleware también corta las tres rutas durante una vista", () => {
    const cookie = { v: 1, sessionId: "s", expiresAt: Date.now() + 60_000 } as never;
    for (const action of ["pause", "resume", "cancel"]) {
      const decision = decideViewAsRequest({ method: "POST", pathname: `/api/v1/broadcasts/${id}/${action}`, cookie });
      expect(decision).toMatchObject({ allow: false, reason: "read_only" });
    }
  });
});

describe("respuestas", () => {
  it("pausar responde el estado nuevo y el avance real", async () => {
    const res = await call(pause);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ broadcastId: id, status: "paused", changed: true, progress: { sent: 1, pending: 2 } });
  });

  it("reanudar una difusión que no está en pausa responde 409 con un motivo claro", async () => {
    row().status = "cancelled";
    const res = await call(resume);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("no se puede reanudar");
  });

  it("cancelar responde cuántos recibieron y cuántos no, y queda registrado quién", async () => {
    const res = await call(cancel);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "cancelled", progress: { sent: 1, cancelled: 2, pending: 0 } });
    expect(fake.rows("activity")[0]).toMatchObject({ actor_id: "u1", meta: { action: "broadcast_cancelled", sent: 1, cancelled: 2 } });
  });

  it("una difusión que no existe responde 404", async () => {
    expect((await call(pause, "no-existe")).status).toBe(404);
  });

  it("el avance devuelve el estado y los conteos", async () => {
    const res = await progress(new NextRequest("http://x"), { params: Promise.resolve({ broadcastId: id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ broadcast: { id, status: "sending" }, progress: { total: 3, sent: 1, pending: 2 } });
  });
});
