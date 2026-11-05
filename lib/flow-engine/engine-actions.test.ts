import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext } from "./types";
import { executeFlow } from "./engine";

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

/**
 * Base simulada mínima: registra cada operación y responde lo que el motor
 * necesita para recorrer un flujo (flujo publicado, canal, sesión, etiquetas y
 * definiciones de campos).
 */
function fakeDb(flow: { nodes: unknown[]; edges: unknown[] }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const b: Record<string, unknown> = {};
      const done = () => {
        if (!calls.includes(call)) calls.push(call);
      };
      for (const op of ["insert", "update", "upsert", "delete"]) {
        b[op] = (payload?: unknown) => {
          call.op = op;
          call.payload = payload;
          done();
          return b;
        };
      }
      for (const m of ["select", "order", "limit", "not", "is", "in"]) b[m] = () => b;
      b.eq = (col: string, val: unknown) => {
        call.filters.push([col, val]);
        return b;
      };
      const row = (): unknown => {
        if (table === "flows") return { id: "flow1", status: "published", ...flow };
        if (table === "channels") return { platform: "instagram", late_account_id: null };
        if (table === "flow_sessions") return { id: "sess1" };
        if (table === "tags") return { id: "tag1" };
        if (table === "custom_field_definitions") return { id: "field1" };
        return null;
      };
      b.single = async () => ({ data: row(), error: null });
      b.maybeSingle = async () => ({ data: row(), error: null });
      b.then = (resolve: (v: unknown) => void) => {
        done();
        resolve({ data: [], error: null });
      };
      return b;
    },
  } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

const context = (): FlowExecutionContext =>
  ({
    triggerId: "tr1",
    flowId: "flow1",
    channelId: "ch1",
    contactId: "contact1",
    conversationId: null,
    workspaceId: "ws1",
    incomingMessage: { text: "" },
    startFresh: true,
    variables: {},
  }) as unknown as FlowExecutionContext;

// Así guarda el lienzo los nodos: type "action" y data.actionType (ver
// components/flow-builder/node-palette.tsx y flow-canvas.tsx getDefaultData).
const flowWith = (data: Record<string, unknown>) => ({
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: "keyword", keywords: [] } },
    { id: "a", type: "action", position: { x: 0, y: 0 }, data },
  ],
  edges: [{ id: "e1", source: "t", target: "a" }],
});

describe("nodos action guardados por el lienzo", () => {
  it("addTag agrega la etiqueta al contacto", async () => {
    const { db, calls } = fakeDb(flowWith({ actionType: "addTag", tagName: "vip" }));
    await executeFlow(db, context());
    const tag = calls.find((c) => c.table === "tags" && c.op === "upsert");
    expect(tag?.payload).toMatchObject({ workspace_id: "ws1", name: "vip" });
    const link = calls.find((c) => c.table === "contact_tags");
    expect(link?.op).toBe("upsert");
    expect(link?.payload).toEqual({ contact_id: "contact1", tag_id: "tag1" });
  });

  it("removeTag quita la etiqueta del contacto", async () => {
    const { db, calls } = fakeDb(flowWith({ actionType: "removeTag", tagName: "vip" }));
    await executeFlow(db, context());
    const link = calls.find((c) => c.table === "contact_tags");
    expect(link?.op).toBe("delete");
    expect(link?.filters).toEqual([
      ["contact_id", "contact1"],
      ["tag_id", "tag1"],
    ]);
  });

  it("setCustomField guarda el valor interpolado", async () => {
    const flow = flowWith({ actionType: "setCustomField", fieldSlug: "color", value: "rojo {{nombre}}" });
    const { db, calls } = fakeDb(flow);
    const ctx = context();
    ctx.variables = { nombre: "Ana" };
    await executeFlow(db, ctx);
    const saved = calls.find((c) => c.table === "contact_custom_fields");
    expect(saved?.op).toBe("upsert");
    expect(saved?.payload).toMatchObject({ contact_id: "contact1", field_id: "field1", value: "rojo Ana" });
  });

  it("unsubscribe marca al contacto como no suscrito", async () => {
    const { db, calls } = fakeDb(flowWith({ actionType: "unsubscribe" }));
    await executeFlow(db, context());
    const upd = calls.find((c) => c.table === "contacts" && c.op === "update");
    expect(upd?.payload).toEqual({ is_subscribed: false });
  });

  it("B-19: la baja por flujo queda en el historial del contacto", async () => {
    const { db, calls } = fakeDb(flowWith({ actionType: "unsubscribe" }));
    await executeFlow(db, context());
    const logged = calls.find((c) => c.table === "activity" && c.op === "insert");
    expect(logged?.payload).toEqual([
      expect.objectContaining({
        workspace_id: "ws1",
        type: "contact_unsubscribed",
        contact_id: "contact1",
        meta: { source: "flow", flow_id: "flow1" },
      }),
    ]);
  });

  it("B-19: pasar a atención humana pausa el bot y lo deja en el historial", async () => {
    const { db, calls } = fakeDb(flowWith({ actionType: "humanTakeover" }));
    await executeFlow(db, context());
    const logged = calls.find((c) => c.table === "activity" && c.op === "insert");
    expect(logged?.payload).toEqual([
      expect.objectContaining({ type: "automation_paused", contact_id: "contact1", meta: { source: "flow", flow_id: "flow1" } }),
    ]);
  });
});
