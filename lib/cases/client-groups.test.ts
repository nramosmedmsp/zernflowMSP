import { describe, expect, it } from "vitest";
import {
  bucketByClient,
  caseUrgencyKey,
  compareUrgency,
  paginateClients,
  sortClientCases,
  type UrgencyCase,
} from "./client-groups";
import { clientsHeadline, pageRangeLabel } from "@/components/cases/case-filters";

const NOW = new Date("2026-11-10T15:00:00.000Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function c(id: string, contactId: string, extra: Partial<UrgencyCase> = {}): UrgencyCase {
  return {
    id,
    contactId,
    status: "open",
    openedAt: ago(1),
    waitingSince: ago(1),
    nextActionAt: null,
    scheduledFor: null,
    closedAt: null,
    createdAt: ago(1),
    solutionStatus: null,
    solutionNote: null,
    solutionClockAt: null,
    deadlineHours: null,
    schedule: null,
    ...extra,
  };
}

describe("urgencia de una gestión", () => {
  it("plazo vencido < plazo corriendo < sin plazo", () => {
    const vencido = caseUrgencyKey(c("a", "x", { deadlineHours: 4, openedAt: ago(10) }), "open", NOW);
    const corre = caseUrgencyKey(c("b", "x", { deadlineHours: 4, openedAt: ago(1) }), "open", NOW);
    const libre = caseUrgencyKey(c("d", "x", { waitingSince: ago(99) }), "open", NOW);
    expect(vencido[0]).toBe(0);
    expect(corre[0]).toBe(1);
    expect(libre[0]).toBe(2);
    expect(compareUrgency(vencido, corre)).toBeLessThan(0);
    expect(compareUrgency(corre, libre)).toBeLessThan(0);
  });

  it("compromiso de solución vencido cuenta como reclamo vencido", () => {
    const key = caseUrgencyKey(
      c("a", "x", { deadlineHours: 4, solutionStatus: "in_progress", nextActionAt: ago(2) }),
      "open",
      NOW,
    );
    expect(key[0]).toBe(0);
  });

  it("con horario hábil el plazo corre solo en horas de atención (igual que el chip de la lista)", () => {
    // Lun-vie 09:00-18:00 hora de Lima (UTC-5). 2026-11-10 es martes; NOW = 10:00 Lima.
    const day: [string, string] = ["09:00", "18:00"];
    const hours = { mon: [day], tue: [day], wed: [day], thu: [day], fri: [day], sat: [], sun: [] };
    const schedule: NonNullable<UrgencyCase["schedule"]> = { hours, holidays: [] };
    // Abierta el lunes a las 17:00 Lima con plazo de 4 h hábiles: lleva 2 h hábiles (1 h el lunes + 1 h hoy) → todavía corre.
    // En horas de reloj ya pasaron 17 h → vencida.
    const opened = "2026-11-09T22:00:00.000Z";
    const business = caseUrgencyKey(c("a", "x", { deadlineHours: 4, openedAt: opened, schedule }), "open", NOW);
    const clock = caseUrgencyKey(c("a", "x", { deadlineHours: 4, openedAt: opened }), "open", NOW);
    expect(business[0]).toBe(1);
    expect(clock[0]).toBe(0);
  });

  it("cerradas: la más reciente primero", () => {
    const nueva = caseUrgencyKey(c("a", "x", { status: "won", closedAt: ago(1) }), "closed", NOW);
    const vieja = caseUrgencyKey(c("b", "x", { status: "won", closedAt: ago(50) }), "closed", NOW);
    expect(compareUrgency(nueva, vieja)).toBeLessThan(0);
  });
});

describe("agrupar y paginar por cliente", () => {
  const cases = [
    c("1", "ana", { waitingSince: ago(5) }),
    c("2", "ana", { deadlineHours: 4, openedAt: ago(9) }),
    c("3", "beto", { waitingSince: ago(20) }),
    c("4", "carla", { waitingSince: ago(1) }),
  ];

  it("un cubo por cliente con sus gestiones más urgente primero", () => {
    const buckets = bucketByClient(cases, "open", NOW);
    expect(buckets.map((b) => b.contactId)).toEqual(["ana", "beto", "carla"]);
    expect(buckets[0].caseIds).toEqual(["2", "1"]);
  });

  it("pagina por clientes y cuenta gestiones", () => {
    const buckets = bucketByClient(cases, "open", NOW);
    const p1 = paginateClients(buckets, 1, 2);
    expect(p1.buckets.map((b) => b.contactId)).toEqual(["ana", "beto"]);
    expect(p1).toMatchObject({ page: 1, totalClients: 3, totalCases: 4 });
    expect(paginateClients(buckets, 2, 2).buckets.map((b) => b.contactId)).toEqual(["carla"]);
    // Fuera de rango: primera página.
    expect(paginateClients(buckets, 7, 2).page).toBe(1);
    expect(paginateClients([], 3, 25)).toMatchObject({ buckets: [], page: 1, totalClients: 0, totalCases: 0 });
  });

  it("ordena las gestiones dentro de un cliente", () => {
    const sorted = sortClientCases([cases[0], cases[1]], "open", NOW);
    expect(sorted.map((x) => x.id)).toEqual(["2", "1"]);
  });
});

describe("textos", () => {
  it("encabezado y rango", () => {
    expect(clientsHeadline(12, 15)).toBe("12 clientes · 15 gestiones");
    expect(clientsHeadline(1, 1)).toBe("1 cliente · 1 gestión");
    expect(pageRangeLabel(1, 25, 12, "clientes")).toBe("1–12 de 12 clientes");
    expect(pageRangeLabel(1, 25, 80)).toBe("1–25 de 80");
  });
});
