// PRIV-02: la declaración de consentimiento al importar. Sin ella los contactos entran
// "sin registrar"; con ella quedan como "aceptó" (origen importación, fecha y quién),
// y quien ya estaba de baja NO se reactiva.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";

const state = vi.hoisted(() => ({ fake: null as unknown }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "admin-1" }, workspace: { id: "ws-1" }, role: "admin" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.fake }));
vi.mock("@/lib/rate-limit-http", () => ({ rateLimitDecision: async () => ({ allowed: true }) }));

import { finishImport, processImportBatch, startImport } from "./import";

let fake: FakeDb;

const rows = [
  { line: 2, values: { name: "Nuevo Uno", phone: "987000001" }, custom: {}, fileDuplicateOf: null },
  { line: 3, values: { name: "Nuevo Dos", phone: "987000002" }, custom: {}, fileDuplicateOf: null },
  { line: 4, values: { name: "Existente Sin Registrar", phone: "987000003" }, custom: {}, fileDuplicateOf: null },
  { line: 5, values: { name: "Existente De Baja", phone: "987000004" }, custom: {}, fileDuplicateOf: null },
];

function options(extra: Record<string, unknown> = {}) {
  return { existing: "update", createTags: false, channelId: null, scheduleCases: false, consentDeclared: false, ...extra };
}

async function run(extra: Record<string, unknown>) {
  const opts = options(extra);
  const started = await startImport({ fileName: "clientes.csv", total: rows.length, options: opts as never });
  if (!("batchId" in started)) throw new Error("no inició");
  const batch = await processImportBatch({ batchId: started.batchId, rows, options: opts });
  if (!("result" in batch)) throw new Error(`falló: ${JSON.stringify(batch)}`);
  const finished = await finishImport(started.batchId);
  if (!("result" in finished)) throw new Error("no terminó");
  return { batch: batch.result, finished: finished.result, batchId: started.batchId };
}

const byPhone = (phone: string) => fake.rows("contacts").find((c) => c.phone === phone)!;

beforeEach(() => {
  fake = new FakeDb();
  state.fake = fake;
  fake.seed("workspaces", [{ id: "ws-1", name: "Tienda", slug: "t", settings: {} }]);
  fake.seed("contacts", [
    { id: randomUUID(), workspace_id: "ws-1", display_name: "Existente Sin Registrar", phone: "+51987000003", marketing_status: "unknown", is_subscribed: true },
    { id: randomUUID(), workspace_id: "ws-1", display_name: "Existente De Baja", phone: "+51987000004", marketing_status: "opted_out", is_subscribed: false },
  ]);
});

describe("importar sin la declaración", () => {
  it("los contactos nuevos entran sin registrar y los existentes no cambian", async () => {
    const { batch, finished } = await run({});
    expect(batch).toMatchObject({ created: 2, updated: 2, consented: 0 });
    expect(finished).toMatchObject({ consentDeclared: false, consented: 0 });
    for (const phone of ["+51987000001", "+51987000002"]) {
      const c = byPhone(phone);
      expect(c.marketing_status ?? "unknown").toBe("unknown");
      expect(c.marketing_source ?? null).toBeNull();
    }
    expect(byPhone("+51987000003").marketing_status).toBe("unknown");
    expect(byPhone("+51987000004").marketing_status).toBe("opted_out");
  });
});

describe("importar con la declaración", () => {
  it("deja constancia: aceptó, origen importación, fecha, quién declaró y qué se afirmó", async () => {
    const { batch, finished, batchId } = await run({ consentDeclared: true });
    expect(batch).toMatchObject({ created: 2, updated: 2, consented: 3, optedOutKept: 1 });
    expect(finished).toMatchObject({ consentDeclared: true, consented: 3 });

    for (const phone of ["+51987000001", "+51987000002", "+51987000003"]) {
      expect(byPhone(phone)).toMatchObject({
        marketing_status: "accepted",
        marketing_source: "import",
        marketing_set_by: "admin-1",
        is_subscribed: true,
      });
      expect(typeof byPhone(phone).marketing_status_at).toBe("string");
      expect(String(byPhone(phone).marketing_note)).toContain("clientes.csv");
      expect(String(byPhone(phone).marketing_note)).toContain(`#${batchId.slice(0, 8)}`);
    }
  });

  it("quien ya se dio de baja no se reactiva por estar en la lista", async () => {
    await run({ consentDeclared: true });
    expect(byPhone("+51987000004")).toMatchObject({ marketing_status: "opted_out", is_subscribed: false });
  });

  it("queda registrado en el historial de la importación", async () => {
    await run({ consentDeclared: true });
    const log = fake.rows("activity").find((a) => a.type === "contacts_imported");
    expect(log).toMatchObject({ actor_id: "admin-1", meta: { consent_declared: true, consented: 3 } });
  });

  it("la declaración se toma del registro guardado al empezar, no de lo que mande el navegador después", async () => {
    const started = await startImport({ fileName: "a.csv", total: 1, options: options() as never });
    if (!("batchId" in started)) throw new Error("no inició");
    const res = await processImportBatch({ batchId: started.batchId, rows: [rows[0]], options: options({ consentDeclared: true }) });
    expect(res).toMatchObject({ ok: true, result: { consented: 0 } });
    expect(byPhone("+51987000001").marketing_status ?? "unknown").toBe("unknown");
  });
});
