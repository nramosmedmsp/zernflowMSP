import { describe, expect, it } from "vitest";
import {
  NOTIFICATIONS_READ_RETENTION_DAYS,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
  RETENTION_RULES,
  retentionCutoffIso,
  runRetention,
} from "./retention";

interface Row {
  id: string;
  read_at?: string | null;
  created_at?: string;
  status?: string;
}

/** Base falsa con las tablas que la limpieza podría tocar y otras que jamás debe tocar. */
function fakeDb(tables: Record<string, Row[]>) {
  const touched: string[] = [];
  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      return {
        select() {
          let list = [...rows];
          let max = Infinity;
          const q: Record<string, unknown> = {
            not: (c: string, _op: string, v: unknown) => {
              list = list.filter((r) => (r as unknown as Record<string, unknown>)[c] !== v);
              return q;
            },
            in: (c: string, vs: readonly unknown[]) => {
              list = list.filter((r) => vs.includes((r as unknown as Record<string, unknown>)[c]));
              return q;
            },
            lt: (c: string, v: string) => {
              list = list.filter((r) => {
                const x = (r as unknown as Record<string, string | null | undefined>)[c];
                return !!x && x < v;
              });
              return q;
            },
            order: () => q,
            limit: (n: number) => {
              max = n;
              return q;
            },
            then: (resolve: (v: unknown) => unknown) => resolve({ data: list.slice(0, max).map((r) => ({ id: r.id })), error: null }),
          };
          return q;
        },
        delete() {
          return {
            in(_c: string, ids: readonly string[]) {
              touched.push(table);
              tables[table] = (tables[table] ?? []).filter((r) => !ids.includes(r.id));
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { db: db as never, tables, touched };
}

const NOW = new Date("2026-11-12T12:00:00.000Z");
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * 86_400_000 - extraMs).toISOString();

describe("retentionCutoffIso", () => {
  it("resta exactamente los días", () => {
    expect(retentionCutoffIso(NOW, 90)).toBe(ago(90));
  });
});

describe("runRetention", () => {
  it("borra notificaciones leídas viejas y trabajos terminados viejos", async () => {
    const f = fakeDb({
      notifications: [
        { id: "n1", read_at: ago(91) },
        { id: "n2", read_at: ago(10) },
        { id: "n3", read_at: null, created_at: ago(400) },
      ],
      scheduled_jobs: [
        { id: "j1", status: "completed", created_at: ago(120) },
        { id: "j2", status: "failed", created_at: ago(120) },
        { id: "j3", status: "pending", created_at: ago(400) },
        { id: "j4", status: "processing", created_at: ago(400) },
        { id: "j5", status: "completed", created_at: ago(5) },
      ],
    });
    const r = await runRetention(f.db, NOW);
    expect(f.tables.notifications.map((x) => x.id)).toEqual(["n2", "n3"]);
    expect(f.tables.scheduled_jobs.map((x) => x.id)).toEqual(["j3", "j4", "j5"]);
    expect(r.deleted).toEqual({ notifications: 1, scheduled_jobs: 2 });
    expect(r.capped).toBe(false);
  });

  it("borde: justo en el plazo no se borra; un milisegundo después sí", async () => {
    const f = fakeDb({
      notifications: [
        { id: "justo", read_at: ago(NOTIFICATIONS_READ_RETENTION_DAYS) },
        { id: "pasado", read_at: ago(NOTIFICATIONS_READ_RETENTION_DAYS, 1) },
      ],
    });
    await runRetention(f.db, NOW);
    expect(f.tables.notifications.map((x) => x.id)).toEqual(["justo"]);
  });

  it("solo toca las tablas de las reglas (nunca chats, mensajes, gestiones, historial ni sesiones de Ver como)", async () => {
    const protectedTables = ["messages", "conversations", "cases", "case_notes", "contacts", "activity", "view_as_sessions", "analytics_events"];
    const data: Record<string, Row[]> = {};
    for (const t of protectedTables) data[t] = [{ id: "x", created_at: ago(2000), read_at: ago(2000), status: "completed" }];
    const f = fakeDb(data);
    await runRetention(f.db, NOW);
    expect(f.touched).toEqual([]);
    for (const t of protectedTables) expect(f.tables[t]).toHaveLength(1);
    expect(RETENTION_RULES.map((r) => r.table).sort()).toEqual(["notifications", "scheduled_jobs"]);
  });

  it("respeta el tope por pasada y avisa que queda trabajo", async () => {
    const total = RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES + 10;
    const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: `n${i}`, read_at: ago(200) }));
    const f = fakeDb({ notifications: rows });
    const r = await runRetention(f.db, NOW);
    expect(r.deleted.notifications).toBe(RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES);
    expect(f.tables.notifications).toHaveLength(10);
    expect(r.capped).toBe(true);
  });

  it("un error en una tabla no impide limpiar la otra", async () => {
    const f = fakeDb({ scheduled_jobs: [{ id: "j1", status: "failed", created_at: ago(200) }] });
    const real = f.db as unknown as { from: (t: string) => unknown };
    const wrapped = {
      from(t: string) {
        if (t === "notifications") {
          return {
            select: () => ({
              not: () => ({ lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "falló" } }) }) }) }),
            }),
          };
        }
        return real.from(t);
      },
    };
    const r = await runRetention(wrapped as never, NOW);
    expect(r.errors).toEqual(["notifications: falló"]);
    expect(r.deleted.scheduled_jobs).toBe(1);
  });
});
