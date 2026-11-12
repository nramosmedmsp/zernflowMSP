import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_CASES,
  applyCaseDiff,
  chunkList,
  diffActiveCases,
  loadActiveCases,
  oldestMessageAt,
  shouldSearchServer,
} from "./inbox-paging";
import type { InboxCase } from "./inbox-model";

const c = (id: string, updated_at = "t1", extra: Record<string, unknown> = {}) => ({ id, updated_at, ...extra }) as unknown as InboxCase;

/** Cliente falso: tabla de n gestiones, con el corte de 1 000 por respuesta. */
function fakeDb(n: number) {
  const calls: number[] = [];
  const db = {
    from() {
      let from = 0;
      let to = 0;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          from = a;
          to = b;
          calls.push(a);
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const end = Math.min(to, from + 999, n - 1);
          const data = Array.from({ length: Math.max(0, end - from + 1) }, (_, i) => ({ id: `c${from + i}` }));
          return resolve({ data, error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

describe("loadActiveCases", () => {
  it("lee las 2 300 gestiones activas, no solo las primeras 1 000", async () => {
    const f = fakeDb(2300);
    const r = await loadActiveCases(f.db, "ws");
    expect(r.cases).toHaveLength(2300);
    expect(r.truncated).toBe(false);
  });

  it("al pasar el tope avisa en vez de callar", async () => {
    const f = fakeDb(MAX_ACTIVE_CASES + 5);
    const r = await loadActiveCases(f.db, "ws");
    expect(r.cases).toHaveLength(MAX_ACTIVE_CASES);
    expect(r.truncated).toBe(true);
  });
});

describe("diffActiveCases / applyCaseDiff", () => {
  it("detecta nuevas, modificadas y quitadas (cerradas o reasignadas)", () => {
    const local = [c("a"), c("b"), c("z")];
    const remote = [
      { id: "a", updated_at: "t1" },
      { id: "b", updated_at: "t2" },
      { id: "n", updated_at: "t9" },
    ];
    const d = diffActiveCases(local, remote);
    expect(d.fetchIds.sort()).toEqual(["b", "n"]);
    expect(d.removedIds).toEqual(["z"]);
    const merged = applyCaseDiff(local, d.removedIds, [c("b", "t2", { x: 1 }), c("n", "t9")]);
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "n"]);
    expect((merged[1] as unknown as { x: number }).x).toBe(1);
  });

  it("sin cambios no trae nada", () => {
    const d = diffActiveCases([c("a")], [{ id: "a", updated_at: "t1" }]);
    expect(d).toEqual({ removedIds: [], fetchIds: [] });
  });
});

describe("utilidades", () => {
  it("chunkList parte en tandas", () => {
    expect(chunkList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("busca en el servidor desde 2 letras", () => {
    expect(shouldSearchServer("a")).toBe(false);
    expect(shouldSearchServer(" ab ")).toBe(true);
  });
  it("el cursor es el mensaje más antiguo con fecha", () => {
    expect(oldestMessageAt([{ last_message_at: "2026-02-01" }, { last_message_at: null }, { last_message_at: "2026-01-01" }])).toBe("2026-01-01");
    expect(oldestMessageAt([])).toBeNull();
  });
});
