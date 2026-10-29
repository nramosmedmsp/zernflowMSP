// A-10: marcar leído tiene que ejecutarse de verdad. El constructor de consultas
// de supabase-js no envía nada hasta que se espera (await o .then).

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { persistConversationRead } from "./inbox-read";

describe("persistConversationRead", () => {
  it("deja unread_count en 0 en la base", async () => {
    const db = new FakeDb();
    db.seed("conversations", [
      { id: "cv-1", unread_count: 3 },
      { id: "cv-2", unread_count: 5 },
    ]);
    expect(await persistConversationRead(db as unknown as SupabaseClient, "cv-1")).toBe(true);
    expect(db.rows("conversations").map((c) => c.unread_count)).toEqual([0, 5]);
  });

  it("no basta con armar la consulta: sin esperarla no se envía (el error de antes)", () => {
    const db = new FakeDb();
    db.seed("conversations", [{ id: "cv-1", unread_count: 3 }]);
    void db.from("conversations").update({ unread_count: 0 }).eq("id", "cv-1");
    // El constructor es perezoso: hasta aquí nada se ejecutó en la base.
    expect(db.rows("conversations")[0].unread_count).toBe(3);
  });

  it("si la base falla devuelve false y lo registra, sin lanzar", async () => {
    const db = new FakeDb();
    db.seed("conversations", [{ id: "cv-1", unread_count: 3 }]);
    db.failNext.set("conversations", "update");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await persistConversationRead(db as unknown as SupabaseClient, "cv-1")).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
