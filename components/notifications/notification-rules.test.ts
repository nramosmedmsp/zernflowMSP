import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  markAsRead,
  safeInternalLink,
  unreadIds,
  upsertNotification,
  type NotificationItem,
} from "./notification-rules";

function n(id: string, createdAt: string, readAt: string | null = null): NotificationItem {
  return { id, type: "case_assigned", title: `T ${id}`, body: null, link: null, read_at: readAt, created_at: createdAt };
}

describe("badgeLabel", () => {
  it("oculta el contador en 0 y lo limita a 99+", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-3)).toBeNull();
    expect(badgeLabel(Number.NaN)).toBeNull();
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});

describe("upsertNotification", () => {
  it("agrega la nueva arriba y ordena por fecha", () => {
    const list = [n("a", "2026-10-18T10:00:00Z"), n("b", "2026-10-18T09:00:00Z")];
    const next = upsertNotification(list, n("c", "2026-10-18T11:00:00Z"));
    expect(next.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(list).toHaveLength(2);
  });

  it("reemplaza por id sin duplicar (p. ej. al llegar el UPDATE de leída)", () => {
    const list = [n("a", "2026-10-18T10:00:00Z"), n("b", "2026-10-18T09:00:00Z")];
    const next = upsertNotification(list, n("b", "2026-10-18T09:00:00Z", "2026-10-18T12:00:00Z"));
    expect(next.map((x) => x.id)).toEqual(["a", "b"]);
    expect(next[1].read_at).toBe("2026-10-18T12:00:00Z");
  });

  it("recorta a la cantidad máxima quitando las más antiguas", () => {
    const list = [n("a", "2026-10-18T10:00:00Z"), n("b", "2026-10-18T09:00:00Z")];
    const next = upsertNotification(list, n("c", "2026-10-18T11:00:00Z"), 2);
    expect(next.map((x) => x.id)).toEqual(["c", "a"]);
  });
});

describe("markAsRead / unreadIds", () => {
  const list = [
    n("a", "2026-10-18T10:00:00Z"),
    n("b", "2026-10-18T09:00:00Z", "2026-10-18T09:30:00Z"),
    n("c", "2026-10-18T08:00:00Z"),
  ];

  it("lista las no leídas", () => {
    expect(unreadIds(list)).toEqual(["a", "c"]);
  });

  it("marca solo las indicadas y no cambia la fecha de las ya leídas", () => {
    const next = markAsRead(list, ["a", "b"], "2026-10-18T13:00:00Z");
    expect(next.map((x) => x.read_at)).toEqual(["2026-10-18T13:00:00Z", "2026-10-18T09:30:00Z", null]);
  });

  it("'all' marca todas las pendientes", () => {
    const next = markAsRead(list, "all", "2026-10-18T13:00:00Z");
    expect(unreadIds(next)).toEqual([]);
    expect(next[1].read_at).toBe("2026-10-18T09:30:00Z");
  });
});

describe("safeInternalLink", () => {
  it("acepta rutas internas con parámetros", () => {
    expect(safeInternalLink("/dashboard/inbox?contact=1&case=2")).toBe("/dashboard/inbox?contact=1&case=2");
    expect(safeInternalLink("  /dashboard/cases ")).toBe("/dashboard/cases");
  });

  it("rechaza vacíos, absolutos y trucos de host", () => {
    for (const bad of [null, undefined, "", "dashboard", "https://malo.com", "//malo.com", "/\\malo.com", "javascript:alert(1)", "/a\nb"]) {
      expect(safeInternalLink(bad)).toBeNull();
    }
  });
});
