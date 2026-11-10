import { describe, expect, it } from "vitest";
import {
  filterViewAsPeople,
  formatViewDuration,
  isReadOnlyRejection,
  isViewInProgress,
  logPeriodSince,
  msUntilEndLayer,
  newReadOnlyHit,
  parseLogPeriod,
  viewAsBlockedNotice,
  viewAsComposerNote,
  viewAsMineEmptyNote,
  viewAsRoleText,
  viewAsShortName,
  viewDurationMs,
  withoutSample,
} from "./ui-rules";
import type { ViewAsPersonOption } from "./rules";

const person = { kind: "person" as const, name: "Diego Salazar", label: "Diego Salazar" };
const role = { kind: "role" as const, name: "Asesor de Ventas", label: "Asesor de Ventas" };

describe("textos de la vista", () => {
  it("nombre corto: primer nombre en persona, etiqueta en rol", () => {
    expect(viewAsShortName(person)).toBe("Diego");
    expect(viewAsShortName(role)).toBe("Asesor de Ventas");
  });

  it("nota de la caja y aviso de bloqueo", () => {
    expect(viewAsComposerNote(person)).toBe("Solo lectura: estás viendo como Diego. Sal de «Ver como» para responder.");
    expect(viewAsBlockedNotice(role)).toBe("Solo lectura: estás viendo como Asesor de Ventas. No se guardó nada.");
  });

  it("nota de «Míos» vacío solo en vistas por rol", () => {
    expect(viewAsMineEmptyNote({ kind: "person", teamName: null })).toBeNull();
    expect(viewAsMineEmptyNote({ kind: "role", teamName: "Ventas" })).toContain("la cola real de Ventas");
    expect(viewAsMineEmptyNote({ kind: "role", teamName: null })).toContain("la cola real de la tienda");
    expect(viewAsMineEmptyNote({ kind: "role", teamName: "Ventas" }, false)).not.toContain("Sin asignar");
  });

  it("rol de la franja", () => {
    expect(viewAsRoleText(role, "member", [])).toBe("Asesor de Ventas");
    expect(viewAsRoleText(person, "member", [{ role: "agent", teamName: "Ventas" }])).toBe("Asesor de Ventas");
    expect(
      viewAsRoleText(person, "member", [
        { role: "supervisor", teamName: "Postventa" },
        { role: "agent", teamName: "Ventas" },
      ]),
    ).toBe("Asesor de Ventas · Supervisor de Postventa");
    expect(viewAsRoleText(person, "admin", [{ role: "supervisor", teamName: "Ventas" }])).toBe("Administrador");
    expect(viewAsRoleText(person, "owner", [])).toBe("Dueño");
    expect(viewAsRoleText(person, "member", [])).toBe("Miembro");
  });
});

describe("buscador del selector", () => {
  const people: ViewAsPersonOption[] = [
    { userId: "1", name: "Sofía Paredes", email: "sofia@x.pe", roleLabel: "Miembro", teams: ["Supervisor de Ventas"], status: "active" },
    { userId: "2", name: "Diego Salazar", email: "diego@x.pe", roleLabel: "Miembro", teams: ["Asesor de Ventas"], status: "active" },
    { userId: "3", name: "Ana Torres", email: "ana@x.pe", roleLabel: "Administrador", teams: [], status: "pending" },
  ];
  it("sin texto devuelve todos", () => expect(filterViewAsPeople(people, "  ")).toHaveLength(3));
  it("ignora acentos y mayúsculas", () => expect(filterViewAsPeople(people, "SOFIA").map((p) => p.userId)).toEqual(["1"]));
  it("busca por rol y equipo, con todas las palabras", () => {
    expect(filterViewAsPeople(people, "asesor ventas").map((p) => p.userId)).toEqual(["2"]);
    expect(filterViewAsPeople(people, "administrador").map((p) => p.userId)).toEqual(["3"]);
    expect(filterViewAsPeople(people, "zzz")).toEqual([]);
  });
});

describe("capa de fin", () => {
  it("aparece 5 s antes de caducar", () => {
    const exp = Date.parse("2026-11-10T12:30:00Z");
    expect(msUntilEndLayer("2026-11-10T12:30:00Z", exp - 60_000)).toBe(55_000);
    expect(msUntilEndLayer("2026-11-10T12:30:00Z", exp - 2_000)).toBeLessThan(0);
    expect(msUntilEndLayer("basura", 0)).toBe(0);
  });
});

describe("escrituras bloqueadas", () => {
  it("reconoce el 403 del candado y el 25006 de la base", () => {
    expect(isReadOnlyRejection(403, '{"code":"VIEW_AS_READ_ONLY","message":"x"}')).toBe(true);
    expect(isReadOnlyRejection(400, '{"code":"25006","message":"cannot execute UPDATE in a read-only transaction"}')).toBe(true);
    expect(isReadOnlyRejection(405, '{"code":"25006","message":"cannot execute INSERT in a read-only transaction"}')).toBe(true);
    expect(isReadOnlyRejection(403, '{"error":"No autorizado"}')).toBe(false);
    expect(isReadOnlyRejection(200, "VIEW_AS_READ_ONLY")).toBe(false);
  });
  it("cookie crm_ro_hit solo cuenta si es más nueva", () => {
    expect(newReadOnlyHit("a=1; crm_ro_hit=1700000000000; b=2", 0)).toBe(1700000000000);
    expect(newReadOnlyHit("crm_ro_hit=1700000000000", 1700000000000)).toBeNull();
    expect(newReadOnlyHit("a=1", 0)).toBeNull();
  });
  it("quita la identidad de ejemplo de los selectores", () => {
    expect(withoutSample([{ id: 1 }, { id: 2, sample: true }, { id: 3, sample: false }])).toEqual([{ id: 1 }, { id: 3, sample: false }]);
  });
});

describe("registro", () => {
  const base = { id: "x", started_at: "2026-11-10T14:00:00Z", expires_at: "2026-11-10T14:30:00Z" };
  it("formatea duraciones", () => {
    expect(formatViewDuration(58_000)).toBe("58 s");
    expect(formatViewDuration(252_000)).toBe("4 min 12 s");
    expect(formatViewDuration(3_900_000)).toBe("1 h 05 min");
  });
  it("cerrada con Salir: hasta ended_at", () => {
    const row = { ...base, ended_at: "2026-11-10T14:04:12Z", end_reason: "manual", last_seen_at: "2026-11-10T14:04:00Z" };
    expect(viewDurationMs(row, Date.parse("2026-11-10T20:00:00Z"))).toBe(252_000);
  });
  it("vencida sin salir: hasta la última actividad", () => {
    const row = { ...base, ended_at: "2026-11-10T14:40:00Z", end_reason: "expired", last_seen_at: "2026-11-10T14:12:00Z" };
    expect(viewDurationMs(row, Date.parse("2026-11-10T20:00:00Z"))).toBe(12 * 60_000);
  });
  it("en curso: hasta ahora; vencida sin cerrar: última actividad", () => {
    const open = { ...base, ended_at: null, end_reason: null, last_seen_at: null };
    expect(viewDurationMs(open, Date.parse("2026-11-10T14:05:00Z"))).toBe(5 * 60_000);
    expect(isViewInProgress(open, Date.parse("2026-11-10T14:05:00Z"))).toBe(true);
    expect(isViewInProgress(open, Date.parse("2026-11-10T15:00:00Z"))).toBe(false);
    expect(viewDurationMs({ ...open, last_seen_at: "2026-11-10T14:20:00Z" }, Date.parse("2026-11-10T16:00:00Z"))).toBe(20 * 60_000);
  });
  it("periodos", () => {
    expect(parseLogPeriod("7")).toBe("7");
    expect(parseLogPeriod("x")).toBe("30");
    expect(parseLogPeriod(undefined)).toBe("30");
    expect(logPeriodSince("all", 0)).toBeNull();
    expect(logPeriodSince("7", Date.parse("2026-11-10T00:00:00Z"))).toBe("2026-11-03T00:00:00.000Z");
  });
});
