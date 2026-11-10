// Vista "Por cliente" de Gestiones: agrupación por cliente, paginación por
// cliente, conteos y orden por urgencia, sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { DEFAULT_CASE_PARAMS, CASES_PAGE_SIZE, type CaseListParams } from "@/components/cases/case-filters";
import { loadCases, loadCasesByClient, type DeadlineInfo } from "./load-cases";

const WS = randomUUID();
const USER = randomUUID();
const NOW = new Date("2026-11-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let db: FakeDb;
let venta: string;
let postventa: string;
let consulta: string;
let deadlines: DeadlineInfo;

function contact(name: string): string {
  const [c] = db.seed("contacts", [{ workspace_id: WS, display_name: name }]);
  return c.id as string;
}

function openCase(contactId: string, typeId: string | null, extra: Record<string, unknown> = {}): string {
  const [c] = db.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contactId,
      case_type_id: typeId,
      status: "open",
      opened_at: hoursAgo(1),
      waiting_since: hoursAgo(1),
      ...extra,
    },
  ]);
  return c.id as string;
}

const params = (extra: Partial<CaseListParams> = {}): CaseListParams => ({ ...DEFAULT_CASE_PARAMS, ...extra });

function byClient(extra: Partial<CaseListParams> = {}) {
  return loadCasesByClient(db.asDb() as never, {
    workspaceId: WS,
    userId: USER,
    canSeeOthers: true,
    params: params(extra),
    now: NOW,
    ...deadlines,
  });
}

function byCase(extra: Partial<CaseListParams> = {}) {
  return loadCases(db.asDb() as never, {
    workspaceId: WS,
    userId: USER,
    canSeeOthers: true,
    params: params(extra),
    now: NOW,
  });
}

beforeEach(() => {
  db = new FakeDb();
  [venta, postventa, consulta] = db
    .seed("case_types", [
      { workspace_id: WS, name: "Venta" },
      { workspace_id: WS, name: "Postventa", solution_deadline_hours: 4 },
      { workspace_id: WS, name: "Consulta" },
    ])
    .map((t) => t.id as string);
  deadlines = {
    caseTypes: [
      { id: venta, solutionDeadlineHours: null },
      { id: postventa, solutionDeadlineHours: 4 },
      { id: consulta, solutionDeadlineHours: null },
    ],
    solutionSchedules: null,
  };
});

describe("Gestiones por cliente: agrupación y conteos", () => {
  it("un cliente con 2 gestiones abiertas sale en UNA fila con las dos dentro", async () => {
    const patricia = contact("Patricia");
    const jorge = contact("Jorge");
    openCase(patricia, venta);
    openCase(patricia, postventa);
    openCase(jorge, venta);

    const res = await byClient();
    expect(res.totalClients).toBe(2);
    expect(res.totalCases).toBe(3);
    expect(res.groups.map((g) => g.contactName).sort()).toEqual(["Jorge", "Patricia"]);
    const p = res.groups.find((g) => g.contactId === patricia)!;
    expect(p.cases).toHaveLength(2);
    expect(p.cases.every((c) => c.matches)).toBe(true);
  });

  it("los conteos cuadran con la vista Por gestión (mismos filtros)", async () => {
    const a = contact("Ana");
    const b = contact("Beto");
    openCase(a, venta);
    openCase(a, postventa);
    openCase(b, consulta);
    openCase(b, venta);
    for (const filters of [{}, { type: venta }, { type: postventa }, { q: "an" }, { tab: "today" as const, assignee: "all" }]) {
      const client = await byClient(filters);
      const flat = await byCase(filters);
      expect(client.totalCases).toBe(flat.total);
    }
  });

  it("con un filtro, entra el cliente si UNA gestión coincide; la otra se muestra sin resaltar", async () => {
    const patricia = contact("Patricia");
    const jorge = contact("Jorge");
    const pv = openCase(patricia, postventa);
    const pVenta = openCase(patricia, venta);
    openCase(jorge, venta);

    const res = await byClient({ type: postventa });
    expect(res.totalClients).toBe(1);
    expect(res.totalCases).toBe(1);
    const cases = res.groups[0].cases;
    expect(cases.map((c) => c.id).sort()).toEqual([pv, pVenta].sort());
    expect(cases.find((c) => c.id === pv)!.matches).toBe(true);
    expect(cases.find((c) => c.id === pVenta)!.matches).toBe(false);
  });

  it("la búsqueda por nombre filtra clientes", async () => {
    openCase(contact("Patricia Salas"), venta);
    openCase(contact("Jorge Cáceres"), venta);
    const res = await byClient({ q: "salas" });
    expect(res.groups.map((g) => g.contactName)).toEqual(["Patricia Salas"]);
  });

  it("en Abiertas, una programada del mismo cliente aparece como contexto, no resaltada", async () => {
    const c = contact("Rosa");
    openCase(c, venta);
    const [sched] = db.seed("cases", [
      { workspace_id: WS, contact_id: c, case_type_id: consulta, status: "scheduled", scheduled_for: "2026-12-01T14:00:00.000Z" },
    ]);
    const res = await byClient();
    expect(res.totalCases).toBe(1);
    expect(res.groups[0].cases).toHaveLength(2);
    expect(res.groups[0].cases.find((x) => x.id === sched.id)!.matches).toBe(false);
    // En Programadas es la que coincide.
    const programadas = await byClient({ tab: "scheduled" });
    expect(programadas.totalClients).toBe(1);
    expect(programadas.groups[0].cases.find((x) => x.id === sched.id)!.matches).toBe(true);
  });

  it("Cerradas lista las cerradas que cumplen, no las activas", async () => {
    const c = contact("Luis");
    openCase(c, venta);
    const [closed] = db.seed("cases", [
      { workspace_id: WS, contact_id: c, case_type_id: postventa, status: "resolved", closed_at: hoursAgo(5) },
    ]);
    const res = await byClient({ tab: "closed" });
    expect(res.totalClients).toBe(1);
    expect(res.groups[0].cases.map((x) => x.id)).toEqual([closed.id]);
  });

  it("trae nombre, canal y último mensaje del cliente", async () => {
    const c = contact("Marcelo");
    openCase(c, venta);
    db.seed("conversations", [
      { workspace_id: WS, contact_id: c, channel_id: "ch", platform: "instagram", last_message_at: hoursAgo(2) },
      { workspace_id: WS, contact_id: c, channel_id: "ch2", platform: "whatsapp", last_message_at: hoursAgo(9) },
    ]);
    const [g] = (await byClient()).groups;
    expect(g.platform).toBe("instagram");
    expect(g.lastMessageAt).toBe(hoursAgo(2));
    expect(g.hasConversation).toBe(true);
  });

  it("sin gestiones que cumplan: lista vacía", async () => {
    expect(await byClient()).toMatchObject({ groups: [], totalClients: 0, totalCases: 0, page: 1 });
  });
});

describe("Gestiones por cliente: orden por urgencia", () => {
  it("reclamo vencido primero, luego el que corre contra el plazo, luego por espera", async () => {
    const espera = contact("Espera larga");
    const reciente = contact("Reciente");
    const vencido = contact("Vencido");
    const corriendo = contact("Corriendo");
    openCase(espera, venta, { waiting_since: hoursAgo(30) });
    openCase(reciente, venta, { waiting_since: hoursAgo(1) });
    // Postventa con plazo de 4 h: abierta hace 10 h = vencida; hace 1 h = corre.
    openCase(vencido, postventa, { opened_at: hoursAgo(10), waiting_since: hoursAgo(10) });
    openCase(corriendo, postventa, { opened_at: hoursAgo(1), waiting_since: hoursAgo(1) });

    const res = await byClient();
    expect(res.groups.map((g) => g.contactName)).toEqual(["Vencido", "Corriendo", "Espera larga", "Reciente"]);
  });

  it("la urgencia del cliente es la de su gestión más urgente, y esa va primera dentro de la fila", async () => {
    const c = contact("Patricia");
    const other = contact("Otro");
    const ventaId = openCase(c, venta, { waiting_since: hoursAgo(1) });
    const pv = openCase(c, postventa, { opened_at: hoursAgo(10), waiting_since: hoursAgo(10) });
    openCase(other, venta, { waiting_since: hoursAgo(50) });
    const res = await byClient();
    expect(res.groups.map((g) => g.contactName)).toEqual(["Patricia", "Otro"]);
    expect(res.groups[0].cases.map((x) => x.id)).toEqual([pv, ventaId]);
  });

  it("Para hoy ordena por próximo contacto más cercano", async () => {
    const tarde = contact("Tarde");
    const temprano = contact("Temprano");
    openCase(tarde, venta, { assignee_id: USER, next_action_at: hoursAgo(-2) });
    openCase(temprano, venta, { assignee_id: USER, next_action_at: hoursAgo(3) });
    const res = await byClient({ tab: "today" });
    expect(res.groups.map((g) => g.contactName)).toEqual(["Temprano", "Tarde"]);
  });
});

describe("Gestiones por cliente: paginación por cliente", () => {
  it("pagina por clientes (no por gestiones): cada cliente sale una sola vez y completo", async () => {
    const total = CASES_PAGE_SIZE + 7;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const c = contact(`Cliente ${String(i).padStart(2, "0")}`);
      ids.push(c);
      // Todos con 2 gestiones: una página de 25 clientes trae 50 gestiones.
      openCase(c, venta, { waiting_since: hoursAgo(100 - i) });
      openCase(c, postventa, { opened_at: hoursAgo(1), waiting_since: hoursAgo(100 - i) });
    }
    const p1 = await byClient({ page: 1 });
    const p2 = await byClient({ page: 2 });
    expect(p1.totalClients).toBe(total);
    expect(p1.totalCases).toBe(total * 2);
    expect(p1.groups).toHaveLength(CASES_PAGE_SIZE);
    expect(p2.groups).toHaveLength(7);
    expect(p1.groups.every((g) => g.cases.length === 2)).toBe(true);
    const seen = [...p1.groups, ...p2.groups].map((g) => g.contactId);
    expect(new Set(seen).size).toBe(total);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it("una página fuera de rango vuelve a la primera", async () => {
    openCase(contact("Ana"), venta);
    const res = await byClient({ page: 9 });
    expect(res.page).toBe(1);
    expect(res.groups).toHaveLength(1);
  });

  it("lee más de 1000 gestiones en tandas sin perder ni repetir clientes", async () => {
    const total = 620; // 1240 gestiones: dos tandas de lectura
    for (let i = 0; i < total; i++) {
      const c = contact(`C${i}`);
      openCase(c, venta, { waiting_since: hoursAgo(1) });
      openCase(c, consulta, { waiting_since: hoursAgo(1) });
    }
    const res = await byClient();
    expect(res.totalClients).toBe(total);
    expect(res.totalCases).toBe(total * 2);
    expect(res.truncated).toBe(false);
  });
});
