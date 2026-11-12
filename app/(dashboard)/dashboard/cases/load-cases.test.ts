// Vista "Por cliente" de Gestiones: agrupación por cliente, paginación por
// cliente, conteos y orden por urgencia, sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { DEFAULT_CASE_PARAMS, CASES_PAGE_SIZE, type CaseListParams } from "@/components/cases/case-filters";
import { BOARD_COLUMN_LIMIT } from "@/components/cases/board-model";
import { loadBoard, loadCases, loadCasesByClient, type DeadlineInfo } from "./load-cases";

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

// ── Vista "Tablero" ────────────────────────────────────────────────────────

describe("Tablero: carga de las gestiones abiertas de un tipo", () => {
  let stages: Record<string, string>;
  const otherUser = randomUUID();

  function board(extra: Partial<CaseListParams> = {}, over: { canSeeOthers?: boolean; userId?: string } = {}) {
    return loadBoard(db.asDb() as never, {
      workspaceId: WS,
      userId: over.userId ?? USER,
      canSeeOthers: over.canSeeOthers ?? true,
      params: params({ view: "board", ...extra }),
      now: NOW,
      caseTypes: [
        { id: venta, name: "Venta", color: null },
        { id: postventa, name: "Postventa", color: null },
        { id: consulta, name: "Consulta", color: null },
      ],
      solutionSchedules: null,
    });
  }

  beforeEach(() => {
    const rows = db.seed("case_stages", [
      { case_type_id: venta, name: "Nuevo", kind: "open", position: 0 },
      { case_type_id: venta, name: "Asesorando", kind: "open", position: 1 },
      { case_type_id: venta, name: "Vieja", kind: "open", position: 2, archived_at: NOW.toISOString() },
      { case_type_id: venta, name: "Pagado", kind: "won", position: 3 },
      { case_type_id: venta, name: "No compró", kind: "lost", position: 4 },
      { case_type_id: postventa, name: "Nueva", kind: "open", position: 0 },
    ]);
    stages = Object.fromEntries(rows.map((r) => [r.name as string, r.id as string]));
  });

  it("elige por defecto el primer tipo con gestiones y devuelve sus columnas en orden, sin etapas archivadas ni finales como columna", async () => {
    openCase(contact("Ana"), postventa, { stage_id: stages["Nueva"] });
    const res = await board();
    expect(res.type?.id).toBe(postventa);
    expect(res.chips.map((c) => [c.name, c.count])).toEqual([["Venta", 0], ["Postventa", 1], ["Consulta", 0]]);
    expect(res.cards).toHaveLength(1);
  });

  it("respeta el tipo de la URL y agrupa/cuenta por etapa; lo sin etapa cae en la primera columna", async () => {
    openCase(contact("Ana"), venta, { stage_id: stages["Nuevo"] });
    openCase(contact("Beto"), venta, { stage_id: stages["Asesorando"] });
    openCase(contact("Carla"), venta, { stage_id: stages["Asesorando"] });
    openCase(contact("Dani"), venta, { stage_id: null });
    openCase(contact("Eva"), postventa, { stage_id: stages["Nueva"] });
    const res = await board({ type: venta });
    expect(res.type?.name).toBe("Venta");
    expect(res.total).toBe(4);
    expect(res.columnTotals).toEqual({ [stages["Nuevo"]]: 2, [stages["Asesorando"]]: 2 });
    expect(res.stages.map((s) => s.name)).toContain("Pagado");
    expect(res.cards.map((c) => c.contactName).sort()).toEqual(["Ana", "Beto", "Carla", "Dani"]);
  });

  it("un tipo inválido o inexistente en la URL cae al de por defecto", async () => {
    openCase(contact("Ana"), venta, { stage_id: stages["Nuevo"] });
    expect((await board({ type: "none" })).type?.id).toBe(venta);
    expect((await board({ type: randomUUID() })).type?.id).toBe(venta);
  });

  it("solo abiertas: las programadas y las cerradas no salen", async () => {
    const a = contact("Ana");
    openCase(a, venta, { stage_id: stages["Nuevo"] });
    openCase(contact("Beto"), venta, { stage_id: stages["Nuevo"], status: "scheduled" });
    openCase(contact("Cata"), venta, { stage_id: stages["Nuevo"], status: "won", closed_at: hoursAgo(1) });
    const res = await board({ type: venta });
    expect(res.cards.map((c) => c.contactName)).toEqual(["Ana"]);
    expect(res.chips.find((c) => c.id === venta)?.count).toBe(1);
  });

  it("en Para hoy, solo las mías con próximo contacto vencido o de hoy (un asesor no ve las de otros)", async () => {
    const mine = openCase(contact("Mía"), venta, { stage_id: stages["Nuevo"], assignee_id: USER, next_action_at: hoursAgo(2) });
    openCase(contact("Futura"), venta, { stage_id: stages["Nuevo"], assignee_id: USER, next_action_at: new Date(NOW.getTime() + 5 * 86_400_000).toISOString() });
    openCase(contact("Ajena"), venta, { stage_id: stages["Nuevo"], assignee_id: otherUser, next_action_at: hoursAgo(2) });
    const res = await board({ type: venta, tab: "today" }, { canSeeOthers: false });
    expect(res.cards.map((c) => c.id)).toEqual([mine]);
  });

  it("aplica los filtros de responsable, equipo y búsqueda como las otras vistas", async () => {
    const team = randomUUID();
    openCase(contact("Patricia Salas"), venta, { stage_id: stages["Nuevo"], assignee_id: USER, team_id: team });
    openCase(contact("Jorge Cáceres"), venta, { stage_id: stages["Nuevo"], assignee_id: otherUser });
    expect((await board({ type: venta, q: "salas" })).cards.map((c) => c.contactName)).toEqual(["Patricia Salas"]);
    expect((await board({ type: venta, assignee: "me" })).cards.map((c) => c.contactName)).toEqual(["Patricia Salas"]);
    expect((await board({ type: venta, team })).cards.map((c) => c.contactName)).toEqual(["Patricia Salas"]);
    expect((await board({ type: venta, assignee: otherUser })).cards.map((c) => c.contactName)).toEqual(["Jorge Cáceres"]);
  });

  it("los conteos del tablero cuadran con la vista Por gestión (mismos filtros)", async () => {
    openCase(contact("Ana"), venta, { stage_id: stages["Nuevo"] });
    openCase(contact("Beto"), venta, { stage_id: stages["Asesorando"] });
    openCase(contact("Cata"), postventa, { stage_id: stages["Nueva"] });
    for (const filters of [{ type: venta }, { type: postventa }, { type: venta, q: "an" }]) {
      const b = await board(filters);
      const flat = await byCase(filters);
      expect(b.total).toBe(flat.total);
    }
  });

  it("trae cliente, canal, último mensaje, categoría y permisos mínimos de cada tarjeta", async () => {
    const c = contact("Ana");
    db.seed("conversations", [{ workspace_id: WS, contact_id: c, platform: "whatsapp", last_message_preview: "¿Tienen stock?", last_message_at: hoursAgo(1) }]);
    const cat = randomUUID();
    openCase(c, venta, { stage_id: stages["Nuevo"], category_id: cat, assignee_id: USER, next_action_note: "Llamar" });
    const [card] = (await board({ type: venta })).cards;
    expect(card).toMatchObject({
      contactName: "Ana",
      platform: "whatsapp",
      preview: "¿Tienen stock?",
      hasConversation: true,
      categoryId: cat,
      assigneeId: USER,
      nextActionNote: "Llamar",
      stageId: stages["Nuevo"],
    });
  });

  it("limita las tarjetas por columna y dice cuántas hay en total", async () => {
    for (let i = 0; i < BOARD_COLUMN_LIMIT + 5; i++) openCase(contact(`C${i}`), venta, { stage_id: stages["Nuevo"] });
    openCase(contact("Otra"), venta, { stage_id: stages["Asesorando"] });
    const res = await board({ type: venta });
    expect(res.columnTotals[stages["Nuevo"]]).toBe(BOARD_COLUMN_LIMIT + 5);
    expect(res.cards.filter((c) => c.stageId === stages["Nuevo"])).toHaveLength(BOARD_COLUMN_LIMIT);
    expect(res.cards.filter((c) => c.stageId === stages["Asesorando"])).toHaveLength(1);
    expect(res.total).toBe(BOARD_COLUMN_LIMIT + 6);
  });

  it("la columna se queda con las más urgentes (reclamo vencido antes que espera larga)", async () => {
    const stage = stages["Nueva"];
    const vencida = openCase(contact("Vencida"), postventa, { stage_id: stage, opened_at: hoursAgo(10), waiting_since: hoursAgo(1) });
    const larga = openCase(contact("Larga"), postventa, { stage_id: stage, opened_at: hoursAgo(1), waiting_since: hoursAgo(30) });
    const res = await loadBoard(db.asDb() as never, {
      workspaceId: WS,
      userId: USER,
      canSeeOthers: true,
      params: params({ view: "board", type: postventa }),
      now: NOW,
      caseTypes: [{ id: postventa, name: "Postventa", color: null }],
      solutionSchedules: null,
    });
    // Postventa tiene plazo de 4 h: la vencida (abierta hace 10 h) va primero al recortar.
    expect(res.cards.map((c) => c.id).sort()).toEqual([vencida, larga].sort());
    expect(res.type?.solutionDeadlineHours).toBe(4);
  });

  it("sin tipos activos o sin etapas abiertas no falla", async () => {
    const none = await loadBoard(db.asDb() as never, {
      workspaceId: WS, userId: USER, canSeeOthers: true, params: params({ view: "board" }), now: NOW, caseTypes: [], solutionSchedules: null,
    });
    expect(none).toMatchObject({ type: null, cards: [], total: 0, chips: [] });
    const noStages = await board({ type: consulta });
    expect(noStages.type?.id).toBe(consulta);
    expect(noStages.cards).toEqual([]);
  });
});
