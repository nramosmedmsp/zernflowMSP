// Tanda 9: tipo de contacto visible y confirmado. Lógica pura (pregunta única,
// historial, ajustes), historial de cambios por reglas y la tarea diaria de
// inactividad, sobre la base en memoria.

import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { FakeDb } from "./fake-db.test-helper";
import { closeCase, handleInbound, openCase, runCaseTasks } from "./index";
import { applyInactivityForWorkspace, runContactInactivity } from "./contact-inactivity";
import { loadContactTypeInfo, recordContactTypeChange } from "./contact-type";
import {
  canMakeInactive,
  chatLineText,
  firstName,
  historyLineText,
  inactivityCutoff,
  isChatLineChange,
  normalizeInactivityDays,
  parseInactivitySettings,
  questionOptions,
  ruleReasonText,
  shouldAskContactType,
  snoozeUntil,
  toTypeChange,
  typeStatusText,
  visibleChanges,
  whenText,
  type ContactTypeOption,
  type TypeChange,
} from "./contact-type-model";

type Row = Record<string, unknown>;

const WS = "ws-1";
const OWNER = "u-0-owner";
const ANA = "u-1-ana";
const NOW = new Date("2026-10-18T17:00:00.000Z");

const T = (id: string, name: string, isDefault = false, extra: Partial<ContactTypeOption> = {}): ContactTypeOption => ({
  id,
  name,
  color: "#3b82f6",
  description: null,
  isDefault,
  ...extra,
});

// ── Lógica pura ────────────────────────────────────────────────────────────

describe("pregunta única del chat", () => {
  const base = { confirmedAt: null, snoozedUntil: null, hasWonCase: false };

  it("se pregunta solo si nunca se confirmó, no se pospuso y no tiene ventas ganadas", () => {
    expect(shouldAskContactType(base, NOW)).toBe(true);
    expect(shouldAskContactType({ ...base, confirmedAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(shouldAskContactType({ ...base, hasWonCase: true }, NOW)).toBe(false);
  });

  it("«Preguntar después» la calla 7 días y luego vuelve", () => {
    const until = snoozeUntil(NOW);
    expect(until).toBe("2026-10-25T17:00:00.000Z");
    expect(shouldAskContactType({ ...base, snoozedUntil: until }, NOW)).toBe(false);
    expect(shouldAskContactType({ ...base, snoozedUntil: until }, new Date("2026-10-25T17:00:01.000Z"))).toBe(true);
  });

  it("botones: el tipo por defecto primero («Es nuevo · …»), los siguientes por orden y el resto en «Otro»", () => {
    const types = [
      T("a", "Cliente"),
      T("b", "Prospecto", true),
      T("c", "Cliente frecuente"),
      T("d", "Inactivo"),
      T("e", "Archivado", false, { archived: true }),
    ];
    const { buttons, overflow } = questionOptions(types);
    expect(buttons.map((b) => b.label)).toEqual(["Es nuevo · Prospecto", "Cliente", "Cliente frecuente"]);
    expect(overflow.map((o) => o.name)).toEqual(["Inactivo"]);
    expect(questionOptions([T("b", "Prospecto", true), T("a", "Cliente")]).overflow).toEqual([]);
  });

  it("primer nombre", () => {
    expect(firstName("María Fernanda Rojas")).toBe("María");
    expect(firstName(null)).toBe("este contacto");
  });
});

describe("historial: lectura y textos", () => {
  const names: Record<string, string> = { p: "Prospecto", c: "Cliente", f: "Cliente frecuente" };
  const typeName = (id: string | null) => (id ? names[id] : "Sin tipo");
  const person = (id: string) => (id === ANA ? "Ana" : "Otra persona");

  const row = (over: Partial<{ id: number; created_at: string; actor_id: string | null; from_value: string | null; to_value: string | null; meta: unknown }>) => ({
    id: 1,
    created_at: "2026-10-18T15:00:00.000Z",
    actor_id: null,
    from_value: null,
    to_value: null,
    meta: {},
    ...over,
  });

  it("entiende filas anteriores a la migración (solo meta.reason)", () => {
    expect(toTypeChange(row({ actor_id: ANA, meta: { reason: "manual" } })).source).toBe("manual");
    expect(toTypeChange(row({ meta: { reason: "rule" } })).source).toBe("rule");
    expect(toTypeChange(row({ meta: { reason: "default" } })).source).toBe("sistema");
    expect(toTypeChange(row({ meta: { source: "inactividad", reason_text: "sin compras hace 95 días" } }))).toMatchObject({
      source: "inactividad",
      reasonText: "sin compras hace 95 días",
    });
  });

  it("la asignación silenciosa del tipo por defecto no se muestra; la línea de chat solo para cambios automáticos", () => {
    const silent = toTypeChange(row({ to_value: "p", meta: { source: "sistema" } }));
    const manual = toTypeChange(row({ id: 2, actor_id: ANA, from_value: "p", to_value: "c", meta: { source: "manual" } }));
    const rule = toTypeChange(row({ id: 3, from_value: "c", to_value: "f", meta: { source: "rule", reason_text: "2.ª compra ganada" } }));
    expect(visibleChanges([rule, manual, silent]).map((c) => c.id)).toEqual(["3", "2"]);
    expect([silent, manual, rule].map(isChatLineChange)).toEqual([false, false, true]);
    expect(chatLineText(rule, "María Fernanda", typeName)).toBe("María pasó a Cliente frecuente (2.ª compra ganada)");
  });

  it("líneas del historial y estado de la ficha", () => {
    const manual: TypeChange = { id: "2", at: NOW.toISOString(), fromId: "p", toId: "c", actorId: ANA, source: "manual", reasonText: null, caseId: null };
    const rule: TypeChange = { id: "3", at: NOW.toISOString(), fromId: "c", toId: "f", actorId: null, source: "rule", reasonText: "2.ª compra ganada", caseId: null };
    expect(historyLineText(manual, typeName, person, NOW)).toBe("Prospecto → Cliente (Ana, hoy)");
    expect(historyLineText(rule, typeName, person, NOW)).toBe("Cliente → Cliente frecuente (automático: 2.ª compra ganada, hoy)");
    expect(typeStatusText({ confirmedAt: NOW.toISOString(), history: [manual] }, person, NOW)).toBe("Desde hoy · por Ana");
    expect(typeStatusText({ confirmedAt: null, history: [rule] }, person, NOW)).toBe("Desde hoy · automático (2.ª compra ganada)");
    expect(typeStatusText({ confirmedAt: null, history: [] }, person, NOW)).toBe("Sin confirmar · se asignó solo al llegar");
    expect(typeStatusText({ confirmedAt: "2026-05-01T00:00:00.000Z", history: [] }, person, NOW)).toMatch(/^Confirmado /);
  });

  it("fechas en hora de Lima: hoy, ayer y día", () => {
    expect(whenText("2026-10-18T15:00:00.000Z", NOW)).toBe("hoy");
    expect(whenText("2026-10-17T15:00:00.000Z", NOW)).toBe("ayer");
    expect(whenText("2026-10-05T15:00:00.000Z", NOW)).toBe("5 oct");
    expect(ruleReasonText(1)).toBe("1.ª compra ganada");
    expect(ruleReasonText(null)).toBe("regla de la gestión");
  });
});

describe("ajuste de inactividad", () => {
  it("apagado si falta o está mal; días entre 7 y 3650", () => {
    expect(parseInactivitySettings({})).toEqual({ enabled: false, typeId: null, days: 90 });
    expect(parseInactivitySettings({ contact_type_inactivity: { enabled: true, days: 30 } }).enabled).toBe(false);
    expect(parseInactivitySettings({ contact_type_inactivity: { enabled: true, type_id: "t", days: 30 } })).toEqual({
      enabled: true,
      typeId: "t",
      days: 30,
    });
    expect(normalizeInactivityDays("6")).toBeNull();
    expect(normalizeInactivityDays(7)).toBe(7);
    expect(normalizeInactivityDays(3651)).toBeNull();
    expect(normalizeInactivityDays(12.5)).toBeNull();
  });

  it("respeta lo confirmado a mano después del corte", () => {
    const cutoff = inactivityCutoff(NOW, 90);
    expect(canMakeInactive({ contact_type_id: "c" }, "i", cutoff)).toBe(true);
    expect(canMakeInactive({ contact_type_id: "i" }, "i", cutoff)).toBe(false);
    expect(canMakeInactive({ contact_type_id: "c", contact_type_confirmed_at: "2026-10-10T00:00:00.000Z", contact_type_confirmed_by: ANA }, "i", cutoff)).toBe(false);
    // El relleno de la migración (sin persona) o una confirmación vieja no frenan.
    expect(canMakeInactive({ contact_type_id: "c", contact_type_confirmed_at: "2026-10-10T00:00:00.000Z", contact_type_confirmed_by: null }, "i", cutoff)).toBe(true);
    expect(canMakeInactive({ contact_type_id: "c", contact_type_confirmed_at: "2026-01-10T00:00:00.000Z", contact_type_confirmed_by: ANA }, "i", cutoff)).toBe(true);
  });
});

// ── Con la base en memoria ─────────────────────────────────────────────────

let fake: FakeDb;
const db = () => fake.asDb();
const byName = (table: string, name: string): Row => {
  const row = fake.rows(table).find((r) => r.name === name);
  if (!row) throw new Error(`${table}: ${name} no existe`);
  return row;
};
const typeId = (name: string) => byName("contact_types", name).id as string;
const typeChanges = (contactId?: string) =>
  fake.rows("activity").filter((a) => a.type === "contact_type_changed" && (!contactId || a.contact_id === contactId));
const contactRow = (id: string): Row => fake.rows("contacts").find((c) => c.id === id)!;

async function setup() {
  fake = new FakeDb();
  fake.seed("workspaces", [{ id: WS, name: "Tienda", slug: "tienda", settings: {} }]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ANA, role: "member" },
  ]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
}

function enableInactivity(days = 90, enabled = true, type = "Inactivo") {
  const ws = fake.rows("workspaces")[0];
  ws.settings = { contact_type_inactivity: { enabled, type_id: typeId(type), days } };
}

describe("historial de cambios por reglas y llegada", () => {
  let contactId: string;
  let conversationId: string;

  beforeEach(async () => {
    await setup();
    const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María Fernanda" }]);
    const [conversation] = fake.seed("conversations", [{ workspace_id: WS, contact_id: contact.id, channel_id: "ch" }]);
    contactId = contact.id as string;
    conversationId = conversation.id as string;
  });

  it("al llegar se asigna el tipo por defecto en silencio, sin confirmar", async () => {
    await handleInbound(db(), { workspaceId: WS, contactId, conversationId, at: "2026-10-18T15:00:00.000Z" });
    expect(contactRow(contactId).contact_type_id).toBe(typeId("Prospecto"));
    expect(contactRow(contactId).contact_type_confirmed_at ?? null).toBeNull();
    const [change] = typeChanges(contactId);
    expect(change).toMatchObject({ actor_id: null, from_value: null, to_value: typeId("Prospecto") });
    expect((change.meta as Row).source).toBe("sistema");
    expect((change.meta as Row).reason).toBe("default");
    const info = await loadContactTypeInfo(db(), contactId, contactRow(contactId));
    expect(info.history).toEqual([]); // la asignación silenciosa no se muestra
    expect(info.hasWonCase).toBe(false);
  });

  it("la 1.ª y la 2.ª venta ganada registran la regla con su motivo, sin persona y sin confirmar", async () => {
    const first = (await handleInbound(db(), { workspaceId: WS, contactId, conversationId }))!;
    await closeCase(db(), { caseId: first.caseId, kind: "won", actorId: ANA }, NOW);
    const second = await openCase(db(), { workspaceId: WS, contactId, caseTypeId: byName("case_types", "Venta").id as string, actorId: ANA });
    if (!("ok" in second)) throw new Error("no abrió");
    await closeCase(db(), { caseId: second.caseId, kind: "won", actorId: ANA }, NOW);

    const rules = typeChanges(contactId).filter((a) => (a.meta as Row).source === "rule");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ actor_id: null, from_value: typeId("Prospecto"), to_value: typeId("Cliente"), case_id: first.caseId });
    expect(rules[0].meta).toMatchObject({ source: "rule", reason: "rule", reason_text: "1.ª compra ganada", triggered_by: ANA });
    expect(rules[1]).toMatchObject({ from_value: typeId("Cliente"), to_value: typeId("Cliente frecuente") });
    expect((rules[1].meta as Row).reason_text).toBe("2.ª compra ganada");
    // Una regla no confirma el tipo: lo confirma una persona.
    expect(contactRow(contactId).contact_type_confirmed_at ?? null).toBeNull();

    const info = await loadContactTypeInfo(db(), contactId, contactRow(contactId));
    expect(info.hasWonCase).toBe(true);
    expect(info.history.map((h) => h.source)).toEqual(["rule", "rule"]);
    expect(shouldAskContactType(info, NOW)).toBe(false); // ya compró: no se pregunta
    expect(info.history.every(isChatLineChange)).toBe(true);
  });

  it("recordContactTypeChange guarda quién, de/a, origen y motivo", async () => {
    await recordContactTypeChange(db(), {
      workspaceId: WS,
      contactId,
      actorId: ANA,
      from: typeId("Prospecto"),
      to: typeId("Cliente"),
      source: "manual",
      reason: null,
    });
    const [row] = typeChanges(contactId);
    expect(row).toMatchObject({ actor_id: ANA, from_value: typeId("Prospecto"), to_value: typeId("Cliente") });
    expect(row.meta).toMatchObject({ source: "manual", reason: "manual" });
  });
});

describe("inactividad automática (cron diario)", () => {
  let inactivo: string;
  const win = (contactId: string, closedAt: string) =>
    fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status: "won", closed_at: closedAt }]);
  const contact = (name: string, type: string | null, extra: Row = {}) =>
    fake.seed("contacts", [{ workspace_id: WS, display_name: name, contact_type_id: type ? typeId(type) : null, ...extra }])[0].id as string;

  let viejo: string;
  let reciente: string;
  let sinCompras: string;
  let recompro: string;
  let yaInactivo: string;
  let corregido: string;

  beforeEach(async () => {
    await setup();
    inactivo = typeId("Inactivo");
    enableInactivity(90);
    viejo = contact("Viejo", "Cliente");
    win(viejo, "2026-05-01T17:00:00.000Z");
    reciente = contact("Reciente", "Cliente");
    win(reciente, "2026-09-01T17:00:00.000Z");
    sinCompras = contact("Sin compras", "Prospecto");
    recompro = contact("Recompró", "Cliente frecuente");
    win(recompro, "2026-03-01T17:00:00.000Z");
    win(recompro, "2026-10-01T17:00:00.000Z");
    yaInactivo = contact("Ya inactivo", "Inactivo");
    win(yaInactivo, "2026-01-01T17:00:00.000Z");
    corregido = contact("Corregido", "Cliente", {
      contact_type_confirmed_at: "2026-10-10T17:00:00.000Z",
      contact_type_confirmed_by: ANA,
    });
    win(corregido, "2026-02-01T17:00:00.000Z");
  });

  const deadline = () => Date.now() + 60_000;

  it("pasa a inactivo solo a quien su última venta ganada es anterior al plazo", async () => {
    const stats = await runContactInactivity(db(), { deadline: deadline(), now: NOW });
    expect(stats).toMatchObject({ moved: 1, workspaces: 1, stoppedEarly: false });
    expect(contactRow(viejo).contact_type_id).toBe(inactivo);
    for (const id of [reciente, sinCompras, recompro, corregido]) expect(contactRow(id).contact_type_id).not.toBe(inactivo);
    expect(contactRow(yaInactivo).contact_type_id).toBe(inactivo);

    const changes = typeChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ contact_id: viejo, actor_id: null, from_value: typeId("Cliente"), to_value: inactivo });
    expect(changes[0].meta).toMatchObject({ source: "inactividad", reason_text: "sin compras hace 170 días" });
    // No confirma: lo hizo el sistema.
    expect(contactRow(viejo).contact_type_confirmed_at ?? null).toBeNull();
    const view = toTypeChange(changes[0] as unknown as Parameters<typeof toTypeChange>[0]);
    expect(isChatLineChange(view)).toBe(true);
  });

  describe("con gestión activa", () => {
    const open = (contactId: string, status: string) =>
      fake.seed("cases", [{ workspace_id: WS, contact_id: contactId, status, closed_at: null }])[0];

    it("con una gestión abierta no pasa a inactivo; las demás reglas siguen igual", async () => {
      open(viejo, "open");
      const stats = await runContactInactivity(db(), { deadline: deadline(), now: NOW });
      expect(stats).toMatchObject({ moved: 0, workspaces: 1 });
      expect(contactRow(viejo).contact_type_id).toBe(typeId("Cliente"));
      expect(typeChanges()).toHaveLength(0);
    });

    it("con una gestión programada (p. ej. Recompra programada) tampoco pasa", async () => {
      open(viejo, "scheduled");
      expect(await runContactInactivity(db(), { deadline: deadline(), now: NOW })).toMatchObject({ moved: 0 });
      expect(contactRow(viejo).contact_type_id).toBe(typeId("Cliente"));
    });

    it("una gestión de otro contacto no protege a este, y las cerradas no cuentan", async () => {
      open(reciente, "open");
      for (const status of ["lost", "cancelled"]) open(viejo, status);
      expect(await runContactInactivity(db(), { deadline: deadline(), now: NOW })).toMatchObject({ moved: 1 });
      expect(contactRow(viejo).contact_type_id).toBe(inactivo);
    });

    it("al cerrarse la gestión, pasa en la siguiente pasada (90 días desde la última venta ganada)", async () => {
      const c = open(viejo, "open");
      await runContactInactivity(db(), { deadline: deadline(), now: NOW });
      expect(contactRow(viejo).contact_type_id).toBe(typeId("Cliente"));
      c.status = "lost";
      c.closed_at = "2026-10-18T18:00:00.000Z";
      const next = await runContactInactivity(db(), { deadline: deadline(), now: new Date("2026-10-19T17:00:00.000Z") });
      expect(next).toMatchObject({ moved: 1 });
      expect(contactRow(viejo).contact_type_id).toBe(inactivo);
      expect(typeChanges(viejo)[0].meta).toMatchObject({ source: "inactividad", reason_text: "sin compras hace 171 días" });
    });
  });

  it("es idempotente: repetirlo el mismo día, o al día siguiente, no vuelve a cambiar nada", async () => {
    await runContactInactivity(db(), { deadline: deadline(), now: NOW });
    const again = await runContactInactivity(db(), { deadline: deadline(), now: new Date("2026-10-18T20:00:00.000Z") });
    expect(again).toMatchObject({ moved: 0, workspaces: 0 }); // ya corrió hoy (día de Lima)
    const tomorrow = await runContactInactivity(db(), { deadline: deadline(), now: new Date("2026-10-19T17:00:00.000Z") });
    expect(tomorrow).toMatchObject({ moved: 0, workspaces: 1 });
    // Aunque se fuerce la pasada, quien ya es inactivo no genera otro cambio.
    const forced = await applyInactivityForWorkspace(db(), { workspaceId: WS, typeId: inactivo, days: 90, now: NOW, deadline: deadline() });
    expect(forced).toEqual({ moved: 0, cursor: null });
    expect(typeChanges()).toHaveLength(1);
  });

  it("apagado, o con el tipo archivado, no hace nada", async () => {
    enableInactivity(90, false);
    expect(await runContactInactivity(db(), { deadline: deadline(), now: NOW })).toMatchObject({ moved: 0, workspaces: 0 });
    enableInactivity(90, true);
    byName("contact_types", "Inactivo").archived_at = "2026-01-01T00:00:00.000Z";
    expect(await runContactInactivity(db(), { deadline: deadline(), now: NOW })).toMatchObject({ moved: 0 });
    expect(typeChanges()).toHaveLength(0);
  });

  it("un plazo más corto alcanza a más contactos", async () => {
    enableInactivity(30);
    const stats = await runContactInactivity(db(), { deadline: deadline(), now: NOW });
    // Viejo (may), Reciente (1 sep) y Corregido: no, lo confirmaron hace 8 días.
    expect(stats.moved).toBe(2);
    expect(contactRow(reciente).contact_type_id).toBe(inactivo);
    expect(contactRow(corregido).contact_type_id).not.toBe(inactivo);
  });

  it("lo corre runCaseTasks", async () => {
    const stats = await runCaseTasks(db(), { deadline: deadline(), now: NOW });
    expect(stats.contactsInactivated).toBe(1);
  });

  it("si el tiempo se acaba a mitad, guarda dónde seguir y la siguiente vuelta lo termina", async () => {
    const early = await runContactInactivity(db(), { deadline: Date.now() - 1, now: NOW });
    expect(early.stoppedEarly).toBe(true);
    expect(early.moved).toBe(0);
    const done = await runContactInactivity(db(), { deadline: deadline(), now: NOW });
    expect(done.moved).toBe(1);
  });

  it("si el inactivo vuelve a ganar una venta, las reglas lo devuelven (la más específica gana)", async () => {
    await runContactInactivity(db(), { deadline: deadline(), now: NOW });
    expect(contactRow(viejo).contact_type_id).toBe(inactivo);
    const opened = await openCase(db(), { workspaceId: WS, contactId: viejo, caseTypeId: byName("case_types", "Venta").id as string, actorId: ANA });
    if (!("ok" in opened)) throw new Error("no abrió");
    await closeCase(db(), { caseId: opened.caseId, kind: "won", actorId: ANA }, NOW);
    // Ya tenía 1 venta ganada: esta es la 2.ª, así que vuelve como Cliente frecuente.
    expect(contactRow(viejo).contact_type_id).toBe(typeId("Cliente frecuente"));
    const last = typeChanges(viejo).at(-1)!;
    expect(last).toMatchObject({ from_value: inactivo, to_value: typeId("Cliente frecuente"), actor_id: null });
    expect(last.meta).toMatchObject({ source: "rule", reason_text: "2.ª compra ganada" });
  });

  it("un inactivo sin ventas registradas que gana su primera vuelve como Cliente", async () => {
    const importado = contact("Importado", "Inactivo");
    const opened = await openCase(db(), { workspaceId: WS, contactId: importado, caseTypeId: byName("case_types", "Venta").id as string, actorId: ANA });
    if (!("ok" in opened)) throw new Error("no abrió");
    await closeCase(db(), { caseId: opened.caseId, kind: "won", actorId: ANA }, NOW);
    expect(contactRow(importado).contact_type_id).toBe(typeId("Cliente"));
  });
});
