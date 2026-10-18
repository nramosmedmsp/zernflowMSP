import { describe, expect, it } from "vitest";
import {
  buildCasesHref,
  caseRowHref,
  closedSinceIso,
  formatWaiting,
  ilikePattern,
  isCaseForToday,
  pageRangeLabel,
  parseCaseListParams,
  resolveAssigneeFilter,
  todayBounds,
  todayOrFilter,
} from "./case-filters";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TYPE = "33333333-3333-4333-8333-333333333333";

describe("parámetros de la URL", () => {
  it("usa valores por defecto y descarta lo inválido", () => {
    expect(parseCaseListParams({})).toMatchObject({ tab: "open", page: 1, period: "30", q: "" });
    expect(
      parseCaseListParams({ tab: "otra", type: "no-uuid", assignee: "x", page: "-3", period: "7", stage: "y" }),
    ).toMatchObject({ tab: "open", type: "", assignee: "", page: 1, period: "30", stage: "" });
  });

  it("acepta pestañas, ids, 'none', 'me' y 'all'", () => {
    const p = parseCaseListParams({
      tab: "today",
      type: TYPE,
      team: "none",
      assignee: ["me", "all"],
      page: "3",
      q: "  María  ",
    });
    expect(p).toMatchObject({ tab: "today", type: TYPE, team: "none", assignee: "me", page: 3, q: "María" });
    expect(parseCaseListParams({ assignee: OTHER }).assignee).toBe(OTHER);
    expect(parseCaseListParams({ period: "all" }).period).toBe("all");
  });

  it("arma la URL sin los valores por defecto", () => {
    expect(buildCasesHref({})).toBe("/dashboard/cases");
    expect(buildCasesHref({ tab: "today", q: "ana lópez", page: 2 })).toBe(
      "/dashboard/cases?tab=today&q=ana+l%C3%B3pez&page=2",
    );
    // El periodo solo cuenta en Cerradas.
    expect(buildCasesHref({ tab: "open", period: "90" })).toBe("/dashboard/cases");
    expect(buildCasesHref({ tab: "closed", period: "90" })).toBe("/dashboard/cases?tab=closed&period=90");
  });
});

describe("responsable efectivo", () => {
  it("Para hoy: un asesor solo ve las suyas aunque pida otra cosa", () => {
    expect(resolveAssigneeFilter("today", OTHER, ME, false)).toEqual({ kind: "user", userId: ME });
    expect(resolveAssigneeFilter("today", "all", ME, false)).toEqual({ kind: "user", userId: ME });
  });

  it("Para hoy: administradores y supervisores parten de las suyas y pueden ver otras", () => {
    expect(resolveAssigneeFilter("today", "", ME, true)).toEqual({ kind: "user", userId: ME });
    expect(resolveAssigneeFilter("today", "all", ME, true)).toEqual({ kind: "all" });
    expect(resolveAssigneeFilter("today", OTHER, ME, true)).toEqual({ kind: "user", userId: OTHER });
    expect(resolveAssigneeFilter("today", "none", ME, true)).toEqual({ kind: "none" });
  });

  it("otras pestañas: todos por defecto", () => {
    expect(resolveAssigneeFilter("open", "", ME, false)).toEqual({ kind: "all" });
    expect(resolveAssigneeFilter("open", "me", ME, false)).toEqual({ kind: "user", userId: ME });
    expect(resolveAssigneeFilter("closed", "none", ME, false)).toEqual({ kind: "none" });
  });
});

describe("Para hoy", () => {
  // 18 oct 2026, 10:00 en Lima (UTC-5) = 15:00 UTC.
  const now = new Date("2026-10-18T15:00:00.000Z");
  const bounds = todayBounds(now);

  it("el día va de las 00:00 de Lima a las 00:00 del día siguiente", () => {
    expect(bounds).toEqual({ startIso: "2026-10-18T05:00:00.000Z", endIso: "2026-10-19T05:00:00.000Z" });
  });

  it("a las 23:30 de Lima sigue siendo el mismo día", () => {
    expect(todayBounds(new Date("2026-10-19T04:30:00.000Z")).startIso).toBe("2026-10-18T05:00:00.000Z");
  });

  const base = { id: "c1", status: "open" as const, assigneeId: ME, nextActionAt: null as string | null };

  it("incluye próximo contacto vencido o de hoy", () => {
    expect(isCaseForToday({ ...base, nextActionAt: "2026-10-10T14:00:00.000Z" }, ME, bounds)).toBe(true);
    expect(isCaseForToday({ ...base, nextActionAt: "2026-10-18T20:00:00.000Z" }, ME, bounds)).toBe(true);
    // 23:59 de Lima de hoy
    expect(isCaseForToday({ ...base, nextActionAt: "2026-10-19T04:59:00.000Z" }, ME, bounds)).toBe(true);
  });

  it("excluye próximo contacto de mañana o sin fecha", () => {
    expect(isCaseForToday({ ...base, nextActionAt: "2026-10-19T05:00:00.000Z" }, ME, bounds)).toBe(false);
    expect(isCaseForToday(base, ME, bounds)).toBe(false);
  });

  it("incluye las activadas hoy aunque no tengan próximo contacto", () => {
    expect(isCaseForToday(base, ME, bounds, new Set(["c1"]))).toBe(true);
    expect(isCaseForToday(base, ME, bounds, new Set(["otra"]))).toBe(false);
  });

  it("solo abiertas y asignadas al usuario", () => {
    const due = { ...base, nextActionAt: "2026-10-10T14:00:00.000Z" };
    expect(isCaseForToday({ ...due, assigneeId: OTHER }, ME, bounds)).toBe(false);
    expect(isCaseForToday({ ...due, assigneeId: null }, ME, bounds)).toBe(false);
    expect(isCaseForToday({ ...due, status: "scheduled" }, ME, bounds, new Set(["c1"]))).toBe(false);
    expect(isCaseForToday({ ...due, status: "won" }, ME, bounds)).toBe(false);
  });

  it("arma la condición or de PostgREST", () => {
    expect(todayOrFilter(bounds, [])).toBe("next_action_at.lt.2026-10-19T05:00:00.000Z");
    expect(todayOrFilter(bounds, [TYPE, TYPE, "no-uuid"])).toBe(
      `next_action_at.lt.2026-10-19T05:00:00.000Z,id.in.(${TYPE})`,
    );
  });
});

describe("Cerradas", () => {
  const now = new Date("2026-10-18T15:00:00.000Z");
  it("calcula el límite del periodo", () => {
    expect(closedSinceIso("30", now)).toBe("2026-09-18T15:00:00.000Z");
    expect(closedSinceIso("90", now)).toBe("2026-07-20T15:00:00.000Z");
    expect(closedSinceIso("all", now)).toBeNull();
  });
});

describe("filas y textos", () => {
  it("la fila va a la bandeja si hay conversación y a la ficha si no", () => {
    expect(caseRowHref("c-1", "g-1", true)).toBe("/dashboard/inbox?contact=c-1&case=g-1");
    expect(caseRowHref("c-1", "g-1", false)).toBe("/dashboard/contacts/c-1");
  });

  it("formatea la espera", () => {
    const now = new Date("2026-10-18T15:00:00.000Z");
    expect(formatWaiting(null, now)).toBe("");
    expect(formatWaiting("2026-10-18T14:59:40.000Z", now)).toBe("ahora");
    expect(formatWaiting("2026-10-18T14:48:00.000Z", now)).toBe("12 min");
    expect(formatWaiting("2026-10-18T12:00:00.000Z", now)).toBe("3 h");
    expect(formatWaiting("2026-10-15T15:00:00.000Z", now)).toBe("3 d");
  });

  it("describe el rango de la página", () => {
    expect(pageRangeLabel(1, 25, 0)).toBe("0 de 0");
    expect(pageRangeLabel(1, 25, 80)).toBe("1–25 de 80");
    expect(pageRangeLabel(4, 25, 80)).toBe("76–80 de 80");
  });

  it("escapa el patrón de búsqueda", () => {
    expect(ilikePattern("ana")).toBe("%ana%");
    expect(ilikePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});
