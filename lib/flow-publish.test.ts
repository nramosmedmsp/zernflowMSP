import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ db: null as unknown, role: "admin" as string }));

vi.mock("@/lib/api-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireApiAdmin: async () =>
      state.role === "owner" || state.role === "admin"
        ? { ok: true, ctx: { supabase: state.db, user: { id: "u-admin" }, workspaceId: "ws-1", role: state.role } }
        : { ok: false, response: NextResponse.json({ error: "Solo el Dueño o un Administrador pueden hacer esto." }, { status: 403 }) },
  };
});

import { POST as publish } from "@/app/api/v1/flows/[flowId]/publish/route";
import { POST as restore } from "@/app/api/v1/flows/[flowId]/versions/[versionId]/restore/route";
import { PUT as saveFlow } from "@/app/api/v1/flows/[flowId]/route";
import { PATCH as patchChannel } from "@/app/api/v1/channels/[channelId]/route";

let fake: FakeDb;
const rows = (t: string) => fake.rows(t);

const goodNodes = (keyword = "hola", text = "Hola {{nombre}}") => [
  { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword", keywords: [{ value: keyword, matchType: "exact" }] } },
  { id: "m", type: "sendMessage", position: { x: 0, y: 0 }, data: { messages: [{ text }] } },
];
const goodEdges = [{ id: "e", source: "t", target: "m" }];

function req(body?: unknown) {
  return new NextRequest("http://localhost/api", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
const pubParams = (flowId: string) => ({ params: Promise.resolve({ flowId }) });

beforeEach(() => {
  fake = new FakeDb();
  state.db = fake.asDb();
  state.role = "admin";
});

function seedFlow(id: string, extra: Record<string, unknown> = {}) {
  fake.seed("flows", [{ id, workspace_id: "ws-1", name: `Flujo ${id}`, nodes: goodNodes(), edges: goodEdges, viewport: null, version: 1, ...extra }]);
}

describe("publicar (M-26 y avisos de B-17 / M-31)", () => {
  it("un flujo sin disparador ni mensajes no se publica (422)", async () => {
    seedFlow("f1", { nodes: [], edges: [] });
    const res = await publish(req(), pubParams("f1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.map((i: { code: string }) => i.code)).toContain("no_trigger");
    expect(rows("flows")[0].status).toBe("draft");
    expect(rows("flow_versions")).toHaveLength(0);
  });

  it("un mensaje vacío no se publica", async () => {
    seedFlow("f1", { nodes: goodNodes("hola", "  ") });
    const res = await publish(req(), pubParams("f1"));
    expect(res.status).toBe(422);
    expect((await res.json()).issues.some((i: { code: string }) => i.code === "empty_message")).toBe(true);
  });

  it("un flujo correcto se publica, crea la versión y sincroniza los disparadores", async () => {
    seedFlow("f1");
    const res = await publish(req(), pubParams("f1"));
    expect(res.status).toBe(200);
    expect(rows("flows")[0]).toMatchObject({ status: "published", version: 2 });
    expect(rows("flow_versions")).toHaveLength(1);
    expect(rows("triggers")).toHaveLength(1);
    expect(rows("triggers")[0]).toMatchObject({ flow_id: "f1", type: "keyword", is_active: true });
  });

  it("una palabra clave repetida en otro flujo publicado pide confirmación y se publica al confirmar", async () => {
    seedFlow("f1");
    seedFlow("f2", { status: "published", name: "Bienvenida" });
    fake.seed("triggers", [{ flow_id: "f2", type: "keyword", config: { keywords: [{ value: "HOLA", matchType: "exact" }] }, is_active: true }]);

    const first = await publish(req(), pubParams("f1"));
    expect(first.status).toBe(409);
    const body = await first.json();
    expect(body.needsConfirmation).toBe(true);
    expect(body.issues[0]).toMatchObject({ code: "keyword_collision", severity: "warning" });
    expect(body.issues[0].message).toContain("Bienvenida");
    expect(rows("flows").find((f) => f.id === "f1")!.status).toBe("draft");

    const second = await publish(req({ confirm: true }), pubParams("f1"));
    expect(second.status).toBe(200);
    expect(rows("flows").find((f) => f.id === "f1")!.status).toBe("published");
  });

  it("un flujo en borrador con la misma palabra no genera aviso", async () => {
    seedFlow("f1");
    seedFlow("f2", { status: "draft" });
    fake.seed("triggers", [{ flow_id: "f2", type: "keyword", config: { keywords: ["hola"] } }]);
    expect((await publish(req(), pubParams("f1"))).status).toBe(200);
  });

  it("una variable desconocida avisa antes de publicar", async () => {
    seedFlow("f1", { nodes: goodNodes("hola", "Hola {{cliente}}") });
    const res = await publish(req(), pubParams("f1"));
    expect(res.status).toBe(409);
    expect((await res.json()).issues[0].code).toBe("unknown_variable");
  });

  it("un asesor no puede publicar (403)", async () => {
    state.role = "member";
    seedFlow("f1");
    expect((await publish(req(), pubParams("f1"))).status).toBe(403);
    expect(rows("flows")[0].status).toBe("draft");
  });
});

describe("restaurar una versión (A-12)", () => {
  const restoreParams = (flowId: string, versionId: string) => ({ params: Promise.resolve({ flowId, versionId }) });

  function seedVersion() {
    fake.seed("flow_versions", [
      { id: "v1", flow_id: "f1", version: 1, name: "Flujo f1", nodes: goodNodes("precio", "Antes"), edges: goodEdges, viewport: null },
    ]);
  }

  it("un flujo publicado sigue publicado, usa la versión restaurada y queda como versión nueva", async () => {
    seedFlow("f1", { status: "published", version: 3, nodes: goodNodes("hola", "Ahora") });
    seedVersion();
    const res = await restore(req(), restoreParams("f1", "v1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "published", version: 4 });
    const flow = rows("flows")[0];
    expect(flow.status).toBe("published");
    expect(JSON.stringify(flow.nodes)).toContain("Antes");
    expect(rows("flow_versions").some((v) => v.version === 4)).toBe(true);
    // El bot lee los disparadores: deben ser los de la versión restaurada.
    expect(JSON.stringify(rows("triggers").map((t) => t.config))).toContain("precio");
  });

  it("un borrador sigue siendo borrador", async () => {
    seedFlow("f1", { status: "draft", version: 3 });
    seedVersion();
    const res = await restore(req(), restoreParams("f1", "v1"));
    expect(res.status).toBe(200);
    expect(rows("flows")[0].status).toBe("draft");
    expect(rows("flow_versions")).toHaveLength(1);
  });

  it("un flujo archivado no se publica al restaurar", async () => {
    seedFlow("f1", { status: "archived" });
    seedVersion();
    await restore(req(), restoreParams("f1", "v1"));
    expect(rows("flows")[0].status).toBe("archived");
  });

  it("una versión de otro flujo da 404", async () => {
    seedFlow("f1");
    seedFlow("f2");
    fake.seed("flow_versions", [{ id: "v9", flow_id: "f2", version: 1, name: "x", nodes: [], edges: [], viewport: null }]);
    expect((await restore(req(), restoreParams("f1", "v9"))).status).toBe(404);
  });

  it("un asesor no puede restaurar", async () => {
    state.role = "member";
    seedFlow("f1");
    seedVersion();
    expect((await restore(req(), restoreParams("f1", "v1"))).status).toBe(403);
  });
});

describe("guardar y encender: sin éxitos falsos (M-25)", () => {
  const put = (body: unknown) => new NextRequest("http://localhost/api", { method: "PUT", body: JSON.stringify(body) });
  const patch = (body: unknown) => new NextRequest("http://localhost/api", { method: "PATCH", body: JSON.stringify(body) });

  it("guardar un flujo que ya no existe da 404, no éxito", async () => {
    const res = await saveFlow(put({ name: "Nuevo" }), pubParams("nope"));
    expect(res.status).toBe(404);
  });

  it("guardar cambia el nombre y devuelve la fila", async () => {
    seedFlow("f1");
    const res = await saveFlow(put({ name: "Nuevo" }), pubParams("f1"));
    expect(res.status).toBe(200);
    expect(rows("flows")[0].name).toBe("Nuevo");
  });

  it("un asesor recibe 403 al guardar", async () => {
    state.role = "member";
    seedFlow("f1");
    expect((await saveFlow(put({ name: "Nuevo" }), pubParams("f1"))).status).toBe(403);
    expect(rows("flows")[0].name).toBe("Flujo f1");
  });

  it("apagar un canal que no existe da 404", async () => {
    const res = await patchChannel(patch({ is_active: false }), { params: Promise.resolve({ channelId: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("apagar un canal cambia la fila; un asesor recibe 403", async () => {
    fake.seed("channels", [{ id: "c1", workspace_id: "ws-1", is_active: true }]);
    const ok = await patchChannel(patch({ is_active: false }), { params: Promise.resolve({ channelId: "c1" }) });
    expect(ok.status).toBe(200);
    expect(rows("channels")[0].is_active).toBe(false);

    state.role = "member";
    const denied = await patchChannel(patch({ is_active: true }), { params: Promise.resolve({ channelId: "c1" }) });
    expect(denied.status).toBe(403);
    expect(rows("channels")[0].is_active).toBe(false);
  });

  it("is_active debe ser un booleano", async () => {
    fake.seed("channels", [{ id: "c1", workspace_id: "ws-1", is_active: true }]);
    const res = await patchChannel(patch({ is_active: "no" }), { params: Promise.resolve({ channelId: "c1" }) });
    expect(res.status).toBe(400);
  });
});
