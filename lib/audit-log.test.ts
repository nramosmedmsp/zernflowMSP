import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  canReadAuditLog,
  encodeAuditCursor,
  loadAuditPage,
  parseAuditCursor,
  parseAuditFilters,
} from "./audit-log";
import type { Db } from "@/lib/cases/io";

const UID = "7df08737-c90b-4a06-9398-b31c478f50a8";

describe("canReadAuditLog", () => {
  it("solo Dueño y Administrador", () => {
    expect(canReadAuditLog("owner")).toBe(true);
    expect(canReadAuditLog("admin")).toBe(true);
    expect(canReadAuditLog("member")).toBe(false);
    expect(canReadAuditLog(null)).toBe(false);
    expect(canReadAuditLog(undefined)).toBe(false);
  });
});

describe("parseAuditFilters", () => {
  it("valores por defecto y entradas inválidas", () => {
    expect(parseAuditFilters(undefined)).toEqual({ person: "", category: "", period: "30" });
    expect(parseAuditFilters({ persona: "' or 1=1", tipo: "nada", periodo: "999" })).toEqual({ person: "", category: "", period: "30" });
  });
  it("acepta persona, sistema, tipo y periodo", () => {
    expect(parseAuditFilters({ persona: UID.toUpperCase(), tipo: "team", periodo: "all" })).toEqual({ person: UID, category: "team", period: "all" });
    expect(parseAuditFilters({ persona: "system", tipo: ["exports"], periodo: "7" })).toEqual({ person: "system", category: "exports", period: "7" });
  });
});

describe("cursor", () => {
  it("ida y vuelta, y rechaza basura", () => {
    const c = encodeAuditCursor({ created_at: "2026-10-29T11:14:00.123456+00:00", id: 77 });
    expect(parseAuditCursor(c)).toEqual({ createdAt: "2026-10-29T11:14:00.123456+00:00", id: "77" });
    for (const bad of [null, 5, "", "x|1", '2026-10-29T11:14:00+00:00|1);drop', '2026-10-29T11:14:00+00:00", id.eq.1|3']) {
      expect(parseAuditCursor(bad)).toBeNull();
    }
  });
});

/** Cliente de pruebas: anota cada llamada de la consulta y devuelve filas fijas. */
function stub(rows: Record<string, unknown>[]) {
  const calls: [string, ...unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return chain;
  };
  for (const name of ["select", "eq", "or", "is", "gte", "order", "in", "not"]) chain[name] = record(name);
  chain.limit = (n: number) => {
    calls.push(["limit", n]);
    return Promise.resolve({ data: rows.slice(0, n), error: null });
  };
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as Db;
  return { db, calls };
}

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: 1000 - i,
    contact_id: null,
    type: "config_changed",
    actor_id: null,
    from_value: null,
    to_value: null,
    meta: { action: "source_downloaded", entity: "source_code" },
    created_at: `2026-10-29T11:${String(59 - (i % 50)).padStart(2, "0")}:00.5+00:00`,
  }));
}

const service = { auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } } } as unknown as Db;

describe("loadAuditPage", () => {
  it("pide 51 filas, devuelve 50 y una clave para la siguiente página", async () => {
    const { db, calls } = stub(rows(AUDIT_PAGE_SIZE + 1));
    const page = await loadAuditPage(db, service, { workspaceId: "ws", filters: { person: "", category: "", period: "30" }, now: Date.UTC(2026, 9, 30) });
    if ("error" in page) throw new Error(page.error);
    expect(calls).toContainEqual(["limit", AUDIT_PAGE_SIZE + 1]);
    expect(calls).toContainEqual(["eq", "workspace_id", "ws"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "id", { ascending: false }]);
    expect(page.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(page.entries[0]).toMatchObject({ title: "Descargó el código de la app", actorName: "Sistema" });
    expect(page.nextCursor).toBe(`${rows(AUDIT_PAGE_SIZE)[AUDIT_PAGE_SIZE - 1].created_at}|${rows(AUDIT_PAGE_SIZE)[AUDIT_PAGE_SIZE - 1].id}`);
  });

  it("sin más filas no hay clave siguiente", async () => {
    const { db } = stub(rows(3));
    const page = await loadAuditPage(db, service, { workspaceId: "ws", filters: { person: "", category: "", period: "all" } });
    if ("error" in page) throw new Error(page.error);
    expect(page.entries).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("aplica persona, tipo, periodo y cursor sin usar OFFSET", async () => {
    const { db, calls } = stub(rows(1));
    await loadAuditPage(db, service, {
      workspaceId: "ws",
      filters: { person: UID, category: "broadcasts", period: "7" },
      cursor: "2026-10-29T11:14:00.5+00:00|55",
      now: Date.UTC(2026, 9, 30),
    });
    expect(calls).toContainEqual(["eq", "actor_id", UID]);
    expect(calls).toContainEqual(["gte", "created_at", new Date(Date.UTC(2026, 9, 23)).toISOString()]);
    expect(calls).toContainEqual(["or", 'created_at.lt."2026-10-29T11:14:00.5+00:00",and(created_at.eq."2026-10-29T11:14:00.5+00:00",id.lt.55)']);
    expect(calls.some(([n, a]) => n === "or" && String(a).includes("broadcast_launched"))).toBe(true);
    expect(calls.some(([n]) => n === "range" || n === "offset")).toBe(false);
  });

  it("«Sistema» filtra las filas sin autor", async () => {
    const { db, calls } = stub([]);
    const page = await loadAuditPage(db, service, { workspaceId: "ws", filters: { person: "system", category: "", period: "all" } });
    expect(calls).toContainEqual(["is", "actor_id", null]);
    expect(page).toEqual({ entries: [], nextCursor: null });
  });
});
