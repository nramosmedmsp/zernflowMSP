// Configuración → Gestiones: reglas de cambio seguro (lógica pura) y acciones
// de servidor (permisos, archivar o borrar, mover gestiones, registro en
// activity), con getWorkspace y los clientes simulados sobre la base en memoria.

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/cases/fake-db.test-helper";
import { applyTemplateWithStore, supabaseTemplateStore } from "@/lib/business-templates";
import { ADMIN_ONLY_MESSAGE } from "@/lib/permissions";
import {
  LAST_OPEN_STAGE_ERROR,
  cleanKeyDateLabel,
  cleanName,
  checkStageKindChange,
  decideRemoval,
  describeRule,
  diffFields,
  hasDuplicateName,
  moveId,
  newStageIndex,
  normalizeColor,
  parseOptionalPositiveInt,
  planDefaultContactType,
  planReorder,
  planStageRemoval,
  positionChanges,
  removalMessage,
  ruleReferences,
  stageKindChangeMessage,
  validateRuleInput,
  type RuleContext,
  type RuleInput,
} from "@/components/settings/cases/config-rules";

const state = vi.hoisted(() => ({ fake: null as unknown, userId: "", workspaceId: "", role: "owner" }));

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: state.userId },
    workspace: { id: state.workspaceId },
    role: state.role,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => state.fake,
  createClient: async () => state.fake,
}));

import {
  addItem,
  addRule,
  archiveCaseType,
  archiveContactType,
  archiveItem,
  createCaseType,
  createContactType,
  getCaseConfig,
  getStageUsage,
  removeCaseType,
  removeContactType,
  removeItem,
  removeRule,
  reorderItems,
  restoreItem,
  saveKeyDateLabel,
  setDefaultContactType,
  setRuleEnabled,
  updateCaseType,
  updateContactType,
  updateItem,
} from "./case-config";

// ── Lógica pura ────────────────────────────────────────────────────────────

const s = (id: string, kind: "open" | "won" | "lost" | "resolved" = "open", archived = false, caseTypeId = "T1") => ({
  id,
  caseTypeId,
  kind,
  archived,
});

describe("nombres y colores", () => {
  it("limpia espacios y rechaza vacío o demasiado largo", () => {
    expect(cleanName("  Pedido   enviado ")).toBe("Pedido enviado");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(101))).toBeNull();
    expect(cleanName(5)).toBeNull();
  });

  it("detecta duplicados sin importar mayúsculas ni tildes, salvo el propio", () => {
    const items = [
      { id: "a", name: "Cambio o devolución" },
      { id: "b", name: "Reclamo" },
    ];
    expect(hasDuplicateName(items, "  cambio o DEVOLUCION")).toBe(true);
    expect(hasDuplicateName(items, "Reclamo", "b")).toBe(false);
    expect(hasDuplicateName(items, "Otro")).toBe(false);
  });

  it("normaliza colores", () => {
    expect(normalizeColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor("rojo")).toBeUndefined();
    expect(normalizeColor("#fff")).toBeUndefined();
  });
});

describe("orden", () => {
  const rows = [
    { id: "a", position: 0, archived: false },
    { id: "b", position: 1, archived: true },
    { id: "c", position: 2, archived: false },
    { id: "d", position: 3, archived: false },
  ];

  it("las activas en el orden pedido y los archivados al final", () => {
    expect(planReorder(rows, ["d", "a", "c"])).toEqual(["d", "a", "c", "b"]);
  });

  it("rechaza listas que no son exactamente las activas", () => {
    expect(planReorder(rows, ["a", "c"])).toBeNull();
    expect(planReorder(rows, ["a", "c", "c"])).toBeNull();
    expect(planReorder(rows, ["a", "c", "b"])).toBeNull();
    expect(planReorder(rows, ["a", "c", "x"])).toBeNull();
  });

  it("solo escribe las posiciones que cambian", () => {
    expect(positionChanges(rows, ["a", "c", "d", "b"])).toEqual([
      { id: "c", position: 1 },
      { id: "d", position: 2 },
      { id: "b", position: 3 },
    ]);
    expect(positionChanges(rows, ["a", "b", "c", "d"])).toEqual([]);
  });

  it("sube y baja un elemento sin salirse de la lista", () => {
    expect(moveId(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b"], "z", "up")).toEqual(["a", "b"]);
  });

  it("una etapa abierta nueva entra antes de las de cierre; las de cierre, al final", () => {
    const active = [{ kind: "open" as const }, { kind: "open" as const }, { kind: "won" as const }, { kind: "lost" as const }];
    expect(newStageIndex(active, "open")).toBe(2);
    expect(newStageIndex(active, "won")).toBe(4);
    expect(newStageIndex([{ kind: "won" as const }], "open")).toBe(0);
    expect(newStageIndex([], "open")).toBe(0);
  });
});

describe("quitar una etapa", () => {
  const stages = [s("a"), s("b"), s("c", "won"), s("d", "open", true), s("x", "open", false, "OTRO")];

  it("no deja al tipo sin etapa abierta activa", () => {
    const solo = [s("a"), s("c", "won")];
    expect(planStageRemoval({ stages: solo, stageId: "a", openCases: 0 })).toEqual({ error: LAST_OPEN_STAGE_ERROR });
    // Una etapa de cierre o archivada sí se puede quitar.
    expect(planStageRemoval({ stages: solo, stageId: "c", openCases: 0 })).toEqual({ ok: true, move: false });
    expect(planStageRemoval({ stages: [...solo, s("d", "open", true)], stageId: "d", openCases: 0 })).toEqual({ ok: true, move: false });
  });

  it("sin gestiones abiertas se quita directo", () => {
    expect(planStageRemoval({ stages, stageId: "a", openCases: 0 })).toEqual({ ok: true, move: false });
  });

  it("con gestiones abiertas pide a qué etapa moverlas", () => {
    const plan = planStageRemoval({ stages, stageId: "a", openCases: 3 });
    expect(plan).toMatchObject({ error: expect.stringContaining("3 gestiones") });
    expect(planStageRemoval({ stages, stageId: "a", openCases: 1 })).toMatchObject({
      error: expect.stringContaining("1 gestión abierta o programada"),
    });
  });

  it("el destino debe ser otra etapa abierta, activa y del mismo tipo", () => {
    const bad = (moveToStageId: string) => planStageRemoval({ stages, stageId: "a", openCases: 2, moveToStageId });
    expect(bad("a")).toMatchObject({ error: expect.any(String) }); // la misma
    expect(bad("c")).toMatchObject({ error: expect.any(String) }); // de cierre
    expect(bad("d")).toMatchObject({ error: expect.any(String) }); // archivada
    expect(bad("x")).toMatchObject({ error: expect.any(String) }); // de otro tipo
    expect(bad("nope")).toMatchObject({ error: expect.any(String) }); // inexistente
    expect(bad("b")).toEqual({ ok: true, move: true });
  });

  it("cambiar la clase de la última abierta no se permite; de otras sí", () => {
    expect(checkStageKindChange({ stages: [s("a"), s("c", "won")], stageId: "a", newKind: "lost" })).toBe(LAST_OPEN_STAGE_ERROR);
    expect(checkStageKindChange({ stages, stageId: "a", newKind: "lost" })).toBeNull();
    expect(checkStageKindChange({ stages, stageId: "c", newKind: "lost" })).toBeNull();
    expect(checkStageKindChange({ stages: [s("a"), s("c", "won")], stageId: "a", newKind: "open" })).toBeNull();
  });

  it("el aviso de cambio de clase habla de métricas y de las gestiones abiertas", () => {
    const msg = stageKindChangeMessage({ name: "Esperando pago", from: "open", to: "won", openCases: 2 });
    expect(msg).toContain("métricas");
    expect(msg).toContain("2 gestiones abiertas están");
    expect(stageKindChangeMessage({ name: "X", from: "won", to: "lost" })).not.toContain("Además");
  });
});

describe("archivar o borrar", () => {
  it("con historial o referencias se archiva; sin uso se borra", () => {
    expect(decideRemoval({ historyCount: 0, configRefs: 0 })).toBe("delete");
    expect(decideRemoval({ historyCount: 1, configRefs: 0 })).toBe("archive");
    expect(decideRemoval({ historyCount: 0, configRefs: 2 })).toBe("archive");
  });

  it("los mensajes explican qué pasó", () => {
    expect(removalMessage("delete", "La etapa «A»")).toBe("La etapa «A» se borró.");
    expect(removalMessage("archive", "La etapa «A»", "history")).toContain("historial");
    expect(removalMessage("archive", "La etapa «A»", "config")).toContain("otra parte de la configuración");
  });

  it("detecta qué menciona una regla", () => {
    const rule = {
      triggerStageId: "st1",
      condition: { category_id: "cat1", outcome_reason_id: "r1", contact_type_id: "ct1" },
      action: "set_contact_type" as const,
      params: { contact_type_id: "ct2" },
    };
    expect(ruleReferences(rule, { stageId: "st1" })).toBe(true);
    expect(ruleReferences(rule, { categoryId: "cat1" })).toBe(true);
    expect(ruleReferences(rule, { outcomeReasonId: "r1" })).toBe(true);
    expect(ruleReferences(rule, { contactTypeId: "ct1" })).toBe(true);
    expect(ruleReferences(rule, { contactTypeId: "ct2" })).toBe(true);
    expect(ruleReferences(rule, { contactTypeId: "ct9" })).toBe(false);
    expect(ruleReferences(rule, { caseTypeId: "x" })).toBe(false);
    const schedule = { triggerStageId: null, condition: {}, action: "schedule_case" as const, params: { case_type_id: "T9", days_after: 25 } };
    expect(ruleReferences(schedule, { caseTypeId: "T9" })).toBe(true);
    expect(ruleReferences(schedule, { stageId: "st1" })).toBe(false);
  });
});

describe("tiempos y etiqueta", () => {
  it("vacío es sin objetivo; solo enteros positivos dentro del máximo", () => {
    expect(parseOptionalPositiveInt("", 100)).toBeNull();
    expect(parseOptionalPositiveInt(null, 100)).toBeNull();
    expect(parseOptionalPositiveInt(" 30 ", 100)).toBe(30);
    expect(parseOptionalPositiveInt(0, 100)).toBeUndefined();
    expect(parseOptionalPositiveInt(1.5, 100)).toBeUndefined();
    expect(parseOptionalPositiveInt("abc", 100)).toBeUndefined();
    expect(parseOptionalPositiveInt(101, 100)).toBeUndefined();
  });

  it("limpia la etiqueta de la fecha clave", () => {
    expect(cleanKeyDateLabel("  Vencimiento   de membresía ")).toBe("Vencimiento de membresía");
    expect(cleanKeyDateLabel("   ")).toBeNull();
    expect(cleanKeyDateLabel("x".repeat(101))).toBeUndefined();
    expect(cleanKeyDateLabel(3)).toBeUndefined();
  });

  it("deja un solo tipo de contacto por defecto", () => {
    const types = [
      { id: "a", isDefault: true, archived: false },
      { id: "b", isDefault: false, archived: false },
      { id: "c", isDefault: false, archived: true },
    ];
    expect(planDefaultContactType(types, "b")).toEqual({ clear: ["a"], set: "b" });
    expect(planDefaultContactType(types, "a")).toEqual({ clear: [], set: "a" });
    expect(planDefaultContactType(types, null)).toEqual({ clear: ["a"], set: null });
    expect(planDefaultContactType(types, "c")).toMatchObject({ error: expect.any(String) });
    expect(planDefaultContactType(types, "z")).toMatchObject({ error: expect.any(String) });
  });

  it("diffFields solo trae lo que cambió", () => {
    expect(diffFields({ name: "A", color: "#fff" }, { name: "B", color: "#fff" })).toEqual({ name: { from: "A", to: "B" } });
    expect(diffFields({ a: null }, { a: undefined })).toEqual({});
  });
});

describe("reglas de gestión", () => {
  const ctx: RuleContext = {
    caseTypeId: "T1",
    stages: [
      { id: "s1", caseTypeId: "T1", archived: false },
      { id: "s2", caseTypeId: "T1", archived: true },
      { id: "sx", caseTypeId: "T2", archived: false },
    ],
    categories: [
      { id: "cat1", caseTypeId: "T1" },
      { id: "catx", caseTypeId: "T2" },
    ],
    reasons: [
      { id: "rw", caseTypeId: "T1", kind: "won" },
      { id: "rl", caseTypeId: "T1", kind: "lost" },
    ],
    contactTypes: [
      { id: "ct1", archived: false },
      { id: "ct2", archived: true },
    ],
    caseTypes: [
      { id: "T1", archived: false },
      { id: "T2", archived: false },
      { id: "T3", archived: true },
    ],
    keyDateLabel: "Vencimiento de membresía",
  };

  const rule = (input: RuleInput) => validateRuleInput(input, ctx);

  it("cambiar tipo de contacto, con 'desde la N-ésima vez'", () => {
    expect(rule({ trigger: "on_won", action: "set_contact_type", contactTypeId: "ct1" })).toEqual({
      ok: true,
      rule: { trigger: "on_won", triggerStageId: null, condition: {}, action: "set_contact_type", params: { contact_type_id: "ct1" } },
    });
    expect(rule({ trigger: "on_won", action: "set_contact_type", contactTypeId: "ct1", fromNthWin: 2 })).toMatchObject({
      ok: true,
      rule: { params: { contact_type_id: "ct1", from_nth_win: 2 } },
    });
    // 1 equivale a siempre: no se guarda.
    expect(rule({ trigger: "on_won", action: "set_contact_type", contactTypeId: "ct1", fromNthWin: 1 })).toMatchObject({
      rule: { params: { contact_type_id: "ct1" } },
    });
    expect(rule({ trigger: "on_won", action: "set_contact_type", contactTypeId: "ct1", fromNthWin: 0 })).toHaveProperty("error");
    expect(rule({ trigger: "on_won", action: "set_contact_type", contactTypeId: "ct2" })).toHaveProperty("error"); // archivado
    expect(rule({ trigger: "on_won", action: "set_contact_type" })).toHaveProperty("error");
  });

  it("programar otra gestión: N días después o N días antes de la fecha clave", () => {
    expect(rule({ trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: "T2", days: 25 })).toMatchObject({
      rule: { params: { case_type_id: "T2", days_after: 25 } },
    });
    expect(
      rule({ trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: "T2", scheduleMode: "days_before_key_date", days: 7 }),
    ).toMatchObject({ rule: { params: { case_type_id: "T2", days_before_key_date: 7 } } });
    expect(rule({ trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: "T3", days: 7 })).toHaveProperty("error"); // archivado
    expect(rule({ trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: "T2", days: -1 })).toHaveProperty("error");
    expect(rule({ trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: "T2", days: 99999 })).toHaveProperty("error");
    expect(rule({ trigger: "on_won", action: "schedule_case", days: 3 })).toHaveProperty("error");
  });

  it("pedir la fecha clave usa la etiqueta o la del espacio", () => {
    expect(rule({ trigger: "on_won", action: "ask_key_date", label: "Fecha de entrega" })).toMatchObject({
      rule: { params: { label: "Fecha de entrega" } },
    });
    expect(rule({ trigger: "on_won", action: "ask_key_date" })).toMatchObject({
      rule: { params: { label: "Vencimiento de membresía" } },
    });
  });

  it("al cambiar a una etapa exige una etapa activa de este tipo", () => {
    const base = { action: "ask_key_date" as const };
    expect(rule({ ...base, trigger: "on_stage", triggerStageId: "s1" })).toMatchObject({ rule: { triggerStageId: "s1" } });
    expect(rule({ ...base, trigger: "on_stage", triggerStageId: "s2" })).toHaveProperty("error");
    expect(rule({ ...base, trigger: "on_stage", triggerStageId: "sx" })).toHaveProperty("error");
    expect(rule({ ...base, trigger: "on_stage" })).toHaveProperty("error");
    // En otro momento la etapa se ignora.
    expect(rule({ ...base, trigger: "on_won", triggerStageId: "s1" })).toMatchObject({ rule: { triggerStageId: null } });
  });

  it("las condiciones deben ser del tipo y coincidir con el momento", () => {
    const base = { action: "ask_key_date" as const };
    expect(rule({ ...base, trigger: "on_won", condition: { categoryId: "cat1", contactTypeId: "ct1" } })).toMatchObject({
      rule: { condition: { category_id: "cat1", contact_type_id: "ct1" } },
    });
    expect(rule({ ...base, trigger: "on_won", condition: { categoryId: "catx" } })).toHaveProperty("error");
    expect(rule({ ...base, trigger: "on_won", condition: { contactTypeId: "nope" } })).toHaveProperty("error");
    expect(rule({ ...base, trigger: "on_lost", condition: { outcomeReasonId: "rl" } })).toMatchObject({
      rule: { condition: { outcome_reason_id: "rl" } },
    });
    expect(rule({ ...base, trigger: "on_lost", condition: { outcomeReasonId: "rw" } })).toHaveProperty("error");
    expect(rule({ ...base, trigger: "on_open", condition: { outcomeReasonId: "rl" } })).toHaveProperty("error");
  });

  it("describe la regla en español", () => {
    const lookup = {
      stages: [{ id: "s1", name: "Esperando pago" }],
      categories: [{ id: "cat1", name: "Reclamo" }],
      reasons: [{ id: "rl", name: "Precio" }],
      contactTypes: [{ id: "ct1", name: "Cliente frecuente" }],
      caseTypes: [{ id: "T2", name: "Recompra" }],
    };
    expect(
      describeRule(
        { trigger: "on_won", triggerStageId: null, condition: {}, action: "set_contact_type", params: { contact_type_id: "ct1", from_nth_win: 2 } },
        lookup,
      ),
    ).toEqual({ when: "Al ganar", condition: null, what: "Cambiar el tipo de contacto a Cliente frecuente desde la vez número 2" });
    expect(
      describeRule(
        { trigger: "on_stage", triggerStageId: "s1", condition: { category_id: "cat1", outcome_reason_id: "rl" }, action: "schedule_case", params: { case_type_id: "T2", days_before_key_date: 1 } },
        lookup,
      ),
    ).toEqual({
      when: "Al cambiar a una etapa: Esperando pago",
      condition: "Si categoría Reclamo y motivo Precio",
      what: "Programar Recompra 1 día antes de la fecha clave",
    });
    expect(
      describeRule({ trigger: "on_open", triggerStageId: null, condition: {}, action: "ask_key_date", params: { label: "Última compra" } }, lookup).what,
    ).toBe("Pedir la fecha clave (Última compra)");
  });
});

// ── Acciones de servidor ───────────────────────────────────────────────────

const WS = randomUUID();
const OTHER_WS = randomUUID();
const OWNER = randomUUID();
const ADMIN = randomUUID();
const AGENT = randomUUID();
const TEAM = randomUUID();

let fake: FakeDb;

function as(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

const typeId = (name: string) => fake.rows("case_types").find((t) => t.name === name)!.id as string;
const stageId = (type: string, name: string) =>
  fake.rows("case_stages").find((x) => x.case_type_id === typeId(type) && x.name === name)!.id as string;
const stageRow = (id: string) => fake.rows("case_stages").find((x) => x.id === id);
const contactTypeId = (name: string) => fake.rows("contact_types").find((t) => t.name === name)!.id as string;
const configLog = () => fake.rows("activity").filter((a) => a.type === "config_changed");
const lastLog = () => configLog().at(-1)!;

function seedCase(type: string, stage: string, extra: Record<string, unknown> = {}) {
  const [contact] = fake.seed("contacts", [{ workspace_id: WS, display_name: "María" }]);
  const [row] = fake.seed("cases", [
    {
      workspace_id: WS,
      contact_id: contact.id,
      case_type_id: typeId(type),
      stage_id: stageId(type, stage),
      status: "open",
      opened_at: "2026-10-18T15:00:00.000Z",
      ...extra,
    },
  ]);
  return row;
}

beforeEach(async () => {
  fake = new FakeDb();
  state.fake = fake;
  state.workspaceId = WS;
  as(OWNER, "owner");
  fake.seed("workspaces", [
    { id: WS, name: "Tienda", slug: "tienda", settings: { agent_visibility: "team" } },
    { id: OTHER_WS, name: "Otra", slug: "otra", settings: {} },
  ]);
  fake.seed("workspace_members", [
    { workspace_id: WS, user_id: OWNER, role: "owner" },
    { workspace_id: WS, user_id: ADMIN, role: "admin" },
    { workspace_id: WS, user_id: AGENT, role: "member" },
  ]);
  fake.seed("teams", [{ id: TEAM, workspace_id: WS, name: "Sede A", is_default: true }]);
  await applyTemplateWithStore(supabaseTemplateStore(fake.asDb()), WS, "ecommerce");
});

describe("permisos", () => {
  it("un asesor no puede leer ni cambiar la configuración", async () => {
    as(AGENT, "member");
    const before = JSON.stringify(fake.tables);
    expect(await getCaseConfig()).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await createCaseType({ name: "Nuevo" })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await updateItem({ list: "stage", id: stageId("Venta", "Asesorando"), name: "Otro" })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await removeItem({ list: "stage", id: stageId("Venta", "Asesorando") })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await createContactType({ name: "VIP" })).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(await saveKeyDateLabel("Otra")).toEqual({ error: ADMIN_ONLY_MESSAGE });
    expect(JSON.stringify(fake.tables)).toBe(before);
  });

  it("el administrador sí puede; no ve elementos de otro espacio", async () => {
    as(ADMIN, "admin");
    const config = await getCaseConfig();
    expect(config).toMatchObject({ ok: true });
    if (!("ok" in config)) throw new Error();
    expect(config.data.caseTypes.map((t) => t.name)).toEqual(["Venta", "Postventa", "Consulta", "Recompra"]);
    expect(config.data.teams).toEqual([{ id: TEAM, name: "Sede A" }]);
    expect(config.data.keyDateLabel).toBe("Última compra");

    const [foreign] = fake.seed("case_types", [{ workspace_id: OTHER_WS, name: "Ajeno" }]);
    expect(await updateCaseType({ id: foreign.id as string, name: "Mío" })).toEqual({ error: "No se encontró el tipo de gestión." });
    expect(await removeCaseType(foreign.id as string)).toEqual({ error: "No se encontró el tipo de gestión." });
    expect(await addItem({ list: "stage", caseTypeId: foreign.id as string, name: "X", kind: "open" })).toEqual({
      error: "No se encontró el tipo de gestión.",
    });
    expect(fake.rows("case_types").find((t) => t.id === foreign.id)!.name).toBe("Ajeno");
  });

  it("rechaza identificadores que no son uuid", async () => {
    expect(await removeItem({ list: "stage", id: "no-es-uuid" })).toMatchObject({ error: expect.any(String) });
    expect(await updateCaseType({ id: "x", name: "Y" })).toEqual({ error: "No se encontró el tipo de gestión." });
  });
});

describe("renombrar, agregar y reordenar: inmediato y registrado", () => {
  it("renombrar una etapa conserva el id y deja registro con el antes y el después", async () => {
    const id = stageId("Venta", "Asesorando");
    expect(await updateItem({ list: "stage", id, name: "  En asesoría " })).toEqual({ ok: true });
    expect(stageRow(id)!.name).toBe("En asesoría");
    expect(lastLog()).toMatchObject({
      workspace_id: WS,
      actor_id: OWNER,
      from_value: "Asesorando",
      to_value: "En asesoría",
      meta: { action: "stage_updated", entity: "stage", entity_id: id, case_type: "Venta", changes: { name: { from: "Asesorando", to: "En asesoría" } } },
    });
  });

  it("no repite nombres dentro del mismo tipo (ni con otras tildes)", async () => {
    const id = stageId("Venta", "Asesorando");
    expect(await updateItem({ list: "stage", id, name: "esperando PAGO" })).toEqual({ error: "Ya hay otro elemento con ese nombre en este tipo." });
    expect(await addItem({ list: "stage", caseTypeId: typeId("Venta"), name: "pagado", kind: "won" })).toEqual({
      error: "Ya hay una etapa con ese nombre en este tipo.",
    });
    expect(await createCaseType({ name: "venta" })).toEqual({ error: "Ya existe un tipo de gestión con ese nombre." });
    // El mismo nombre en otro tipo sí se admite.
    expect(await addItem({ list: "stage", caseTypeId: typeId("Consulta"), name: "Asesorando", kind: "open" })).toMatchObject({ ok: true });
  });

  it("una etapa abierta nueva entra antes de las de cierre", async () => {
    const result = await addItem({ list: "stage", caseTypeId: typeId("Venta"), name: "Negociando", kind: "open" });
    expect(result).toMatchObject({ ok: true });
    const ordered = fake
      .rows("case_stages")
      .filter((x) => x.case_type_id === typeId("Venta"))
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((x) => x.name);
    expect(ordered).toEqual([
      "Nuevo interesado",
      "Asesorando",
      "Pedido o enlace de pago enviado",
      "Esperando pago",
      "Negociando",
      "Pagado",
      "No compró",
    ]);
    expect(lastLog().meta).toMatchObject({ action: "stage_created", entity: "stage", name: "Negociando" });
  });

  it("reordenar exige exactamente las etapas activas", async () => {
    const venta = typeId("Venta");
    const ids = fake
      .rows("case_stages")
      .filter((x) => x.case_type_id === venta)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((x) => x.id as string);
    expect(await reorderItems({ list: "stage", caseTypeId: venta, orderedIds: ids.slice(1) })).toMatchObject({ error: expect.any(String) });
    const swapped = [ids[1], ids[0], ...ids.slice(2)];
    expect(await reorderItems({ list: "stage", caseTypeId: venta, orderedIds: swapped })).toEqual({ ok: true });
    expect(stageRow(ids[1])!.position).toBe(0);
    expect(stageRow(ids[0])!.position).toBe(1);
    expect(lastLog().meta).toMatchObject({ action: "stage_reordered" });
  });

  it("crear un tipo lo deja usable: etapas Abierta y Resuelta", async () => {
    const result = await createCaseType({ name: "Garantía", color: "#123456", icon: "wrench", isProactive: false });
    expect(result).toMatchObject({ ok: true });
    const created = fake.rows("case_types").find((t) => t.name === "Garantía")!;
    expect(created.position).toBe(4);
    const stages = fake.rows("case_stages").filter((x) => x.case_type_id === created.id);
    expect(stages.map((x) => [x.name, x.kind])).toEqual([
      ["Abierta", "open"],
      ["Resuelta", "resolved"],
    ]);
    expect(await createCaseType({ name: "Otro", icon: "no-existe" })).toEqual({ error: "El ícono no es válido." });
    expect(await createCaseType({ name: "Otro", color: "azul" })).toEqual({ error: "El color no es válido." });
  });
});

describe("quitar una etapa", () => {
  it("con gestiones abiertas pide a qué etapa moverlas y no toca nada hasta entonces", async () => {
    const c1 = seedCase("Venta", "Asesorando");
    seedCase("Venta", "Asesorando", { status: "scheduled", scheduled_for: "2026-11-01T00:00:00.000Z" });
    const from = stageId("Venta", "Asesorando");

    const usage = await getStageUsage(from);
    expect(usage).toMatchObject({ ok: true, usage: { openCases: 2, closedCases: 0, isLastOpen: false } });

    expect(await archiveItem({ list: "stage", id: from })).toMatchObject({ error: expect.stringContaining("2 gestiones") });
    expect(await removeItem({ list: "stage", id: from })).toMatchObject({ error: expect.stringContaining("2 gestiones") });
    expect(stageRow(from)!.archived_at).toBeNull();
    expect(fake.rows("cases").find((c) => c.id === c1.id)!.stage_id).toBe(from);
    expect(configLog()).toHaveLength(0);
  });

  it("las mueve y luego archiva; deja registro de cada gestión movida", async () => {
    const c1 = seedCase("Venta", "Asesorando");
    const c2 = seedCase("Venta", "Asesorando", { status: "scheduled", scheduled_for: "2026-11-01T00:00:00.000Z" });
    const from = stageId("Venta", "Asesorando");
    const to = stageId("Venta", "Nuevo interesado");

    expect(await archiveItem({ list: "stage", id: from, moveToStageId: to })).toEqual({ ok: true, moved: 2 });
    expect(stageRow(from)!.archived_at).not.toBeNull();
    expect(fake.rows("cases").find((c) => c.id === c1.id)!.stage_id).toBe(to);
    expect(fake.rows("cases").find((c) => c.id === c2.id)!.stage_id).toBe(to);

    const moves = fake.rows("activity").filter((a) => a.type === "stage_changed");
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ actor_id: OWNER, from_value: from, to_value: to, meta: { source: "config" } });
    expect(lastLog().meta).toMatchObject({ action: "stage_archived", moved_cases: 2, moved_to_stage_id: to });
  });

  it("no acepta como destino una etapa de cierre, archivada o de otro tipo", async () => {
    seedCase("Venta", "Asesorando");
    const from = stageId("Venta", "Asesorando");
    for (const to of [stageId("Venta", "Pagado"), stageId("Postventa", "Nueva"), from]) {
      expect(await archiveItem({ list: "stage", id: from, moveToStageId: to })).toMatchObject({ error: expect.any(String) });
    }
    expect(stageRow(from)!.archived_at).toBeNull();
  });

  it("no deja al tipo sin etapa abierta activa", async () => {
    const abierta = stageId("Consulta", "Abierta");
    expect(await archiveItem({ list: "stage", id: abierta })).toEqual({ error: LAST_OPEN_STAGE_ERROR });
    expect(await removeItem({ list: "stage", id: abierta })).toEqual({ error: LAST_OPEN_STAGE_ERROR });
    expect(await updateItem({ list: "stage", id: abierta, kind: "won", confirmedKindChange: true })).toEqual({ error: LAST_OPEN_STAGE_ERROR });
    expect(stageRow(abierta)!.archived_at).toBeNull();
    expect(stageRow(abierta)!.kind).toBe("open");
    expect(await getStageUsage(abierta)).toMatchObject({ usage: { isLastOpen: true } });
  });

  it("con historial (gestiones cerradas) se archiva; sin uso se borra", async () => {
    seedCase("Venta", "Pagado", { status: "won", closed_at: "2026-10-18T16:00:00.000Z" });
    const used = stageId("Venta", "Pagado");
    const unused = stageId("Venta", "No compró");

    const archived = await removeItem({ list: "stage", id: used });
    expect(archived).toMatchObject({ ok: true, outcome: "archive", moved: 0, message: expect.stringContaining("historial") });
    expect(stageRow(used)!.archived_at).not.toBeNull();

    const deleted = await removeItem({ list: "stage", id: unused });
    expect(deleted).toMatchObject({ ok: true, outcome: "delete" });
    expect(stageRow(unused)).toBeUndefined();
    expect(lastLog().meta).toMatchObject({ action: "stage_deleted", name: "No compró" });
  });

  it("al borrar una etapa sin uso también se borran las reglas que empiezan en ella", async () => {
    const venta = typeId("Venta");
    const stage = stageId("Venta", "Esperando pago");
    const added = await addRule({
      caseTypeId: venta,
      rule: { trigger: "on_stage", triggerStageId: stage, action: "ask_key_date", label: "Fecha" },
    });
    expect(added).toMatchObject({ ok: true });
    const result = await removeItem({ list: "stage", id: stage });
    expect(result).toMatchObject({ ok: true, outcome: "delete", message: expect.stringContaining("regla") });
    expect(fake.rows("case_rules").some((r) => r.trigger_stage_id === stage)).toBe(false);
  });

  it("una etapa archivada se reactiva", async () => {
    const id = stageId("Venta", "Esperando pago");
    await archiveItem({ list: "stage", id });
    expect(await restoreItem({ list: "stage", id })).toEqual({ ok: true });
    expect(stageRow(id)!.archived_at).toBeNull();
    expect(lastLog().meta).toMatchObject({ action: "stage_restored" });
  });
});

describe("cambiar la clase de una etapa", () => {
  it("pide confirmación y, confirmada, la cambia y lo registra", async () => {
    const id = stageId("Venta", "Esperando pago");
    const first = await updateItem({ list: "stage", id, kind: "won" });
    expect(first).toMatchObject({ needsConfirmation: true, error: expect.stringContaining("métricas") });
    expect(stageRow(id)!.kind).toBe("open");

    expect(await updateItem({ list: "stage", id, kind: "won", confirmedKindChange: true })).toEqual({ ok: true });
    expect(stageRow(id)!.kind).toBe("won");
    expect(lastLog().meta).toMatchObject({ action: "stage_updated", changes: { kind: { from: "open", to: "won" } } });
  });

  it("repetir la misma clase no pide nada", async () => {
    const id = stageId("Venta", "Esperando pago");
    expect(await updateItem({ list: "stage", id, kind: "open" })).toEqual({ ok: true });
    expect(configLog()).toHaveLength(0);
  });

  it("rechaza clases que no existen", async () => {
    const id = stageId("Venta", "Esperando pago");
    expect(await updateItem({ list: "stage", id, kind: "cerrada", confirmedKindChange: true })).toEqual({ error: "Datos no válidos." });
  });
});

describe("categorías y motivos", () => {
  it("una categoría usada por una gestión se archiva; una sin uso se borra", async () => {
    const postventa = typeId("Postventa");
    const category = fake.rows("case_categories").find((c) => c.case_type_id === postventa && c.name === "Reclamo")!;
    seedCase("Postventa", "Nueva", { category_id: category.id });

    const used = await removeItem({ list: "category", id: category.id as string });
    expect(used).toMatchObject({ ok: true, outcome: "archive" });
    expect(fake.rows("case_categories").find((c) => c.id === category.id)!.archived_at).not.toBeNull();

    const free = fake.rows("case_categories").find((c) => c.case_type_id === postventa && c.name === "Comprobante")!;
    expect(await removeItem({ list: "category", id: free.id as string })).toMatchObject({ ok: true, outcome: "delete" });
    expect(fake.rows("case_categories").some((c) => c.id === free.id)).toBe(false);
  });

  it("un motivo mencionado por una regla no se borra", async () => {
    const venta = typeId("Venta");
    const reason = fake.rows("case_outcome_reasons").find((r) => r.case_type_id === venta && r.name === "Precio")!;
    const rule = await addRule({
      caseTypeId: venta,
      rule: { trigger: "on_lost", condition: { outcomeReasonId: reason.id as string }, action: "ask_key_date", label: "Fecha" },
    });
    expect(rule).toMatchObject({ ok: true });
    expect(await removeItem({ list: "reason", id: reason.id as string })).toMatchObject({ ok: true, outcome: "archive" });
    expect(fake.rows("case_outcome_reasons").some((r) => r.id === reason.id)).toBe(true);
  });

  it("agregar un motivo y cambiar su clase (con confirmación y sin reglas que lo usen)", async () => {
    const venta = typeId("Venta");
    const added = await addItem({ list: "reason", caseTypeId: venta, name: "Sin presupuesto", kind: "lost" });
    expect(added).toMatchObject({ ok: true });
    if (!("ok" in added)) throw new Error();
    expect(await addItem({ list: "reason", caseTypeId: venta, name: "sin presupuesto", kind: "lost" })).toMatchObject({ error: expect.any(String) });
    expect(await updateItem({ list: "reason", id: added.id, kind: "resolved" })).toMatchObject({ needsConfirmation: true });
    expect(await updateItem({ list: "reason", id: added.id, kind: "resolved", confirmedKindChange: true })).toEqual({ ok: true });
    expect(fake.rows("case_outcome_reasons").find((r) => r.id === added.id)!.kind).toBe("resolved");
  });

  it("la alta prioridad de una categoría se cambia y se registra", async () => {
    const postventa = typeId("Postventa");
    const category = fake.rows("case_categories").find((c) => c.case_type_id === postventa && c.name === "Producto dañado")!;
    expect(await updateItem({ list: "category", id: category.id as string, isHighPriority: true })).toEqual({ ok: true });
    expect(fake.rows("case_categories").find((c) => c.id === category.id)!.is_high_priority).toBe(true);
    expect(lastLog().meta).toMatchObject({ changes: { is_high_priority: { from: false, to: true } } });
  });
});

describe("tipos de gestión: destino, tiempos y quitar", () => {
  it("destino fijo exige un equipo activo del espacio", async () => {
    const id = typeId("Venta");
    expect(await updateCaseType({ id, routing: "fixed_team" })).toMatchObject({ error: expect.any(String) });
    expect(await updateCaseType({ id, routing: "fixed_team", fixedTeamId: randomUUID() })).toMatchObject({ error: expect.any(String) });
    expect(await updateCaseType({ id, routing: "fixed_team", fixedTeamId: TEAM })).toEqual({ ok: true });
    const row = fake.rows("case_types").find((t) => t.id === id)!;
    expect(row).toMatchObject({ routing: "fixed_team", fixed_team_id: TEAM });
    // Volver a otro destino limpia el equipo fijo.
    expect(await updateCaseType({ id, routing: "contact_team" })).toEqual({ ok: true });
    expect(fake.rows("case_types").find((t) => t.id === id)).toMatchObject({ routing: "contact_team", fixed_team_id: null });
  });

  it("tiempos: vacío es sin objetivo; solo enteros positivos", async () => {
    const id = typeId("Venta");
    expect(await updateCaseType({ id, slaFirstResponseMinutes: "15", slaResolutionHours: 48 })).toEqual({ ok: true });
    expect(fake.rows("case_types").find((t) => t.id === id)).toMatchObject({ sla_first_response_minutes: 15, sla_resolution_hours: 48 });
    expect(await updateCaseType({ id, slaFirstResponseMinutes: "", slaResolutionHours: null })).toEqual({ ok: true });
    expect(fake.rows("case_types").find((t) => t.id === id)).toMatchObject({ sla_first_response_minutes: null, sla_resolution_hours: null });
    expect(await updateCaseType({ id, slaFirstResponseMinutes: 0 })).toMatchObject({ error: expect.any(String) });
    expect(await updateCaseType({ id, slaResolutionHours: "dos" })).toMatchObject({ error: expect.any(String) });
  });

  it("general: nombre, color, ícono, proactiva, interruptores y tipos de contacto sugeridos", async () => {
    const id = typeId("Consulta");
    const prospecto = contactTypeId("Prospecto");
    expect(
      await updateCaseType({
        id,
        name: "Consultas",
        color: "#ABCDEF",
        icon: "headphones",
        isProactive: true,
        requireCategory: true,
        requireOutcomeReason: true,
        suggestedForContactTypeIds: [prospecto, prospecto],
      }),
    ).toEqual({ ok: true });
    expect(fake.rows("case_types").find((t) => t.id === id)).toMatchObject({
      name: "Consultas",
      color: "#abcdef",
      icon: "headphones",
      is_proactive: true,
      require_category: true,
      require_outcome_reason: true,
      suggested_for_contact_type_ids: [prospecto],
    });
    expect(await updateCaseType({ id, suggestedForContactTypeIds: [randomUUID()] })).toMatchObject({ error: expect.any(String) });
  });

  it("un tipo con gestiones se archiva; uno sin uso se borra; un tipo archivado se reactiva", async () => {
    seedCase("Venta", "Nuevo interesado");
    const venta = await removeCaseType(typeId("Venta"));
    expect(venta).toMatchObject({ ok: true, outcome: "archive", message: expect.stringContaining("historial") });
    expect(fake.rows("case_types").find((t) => t.name === "Venta")!.archived_at).not.toBeNull();

    const consulta = await removeCaseType(typeId("Consulta"));
    expect(consulta).toMatchObject({ ok: true, outcome: "delete" });
    expect(fake.rows("case_types").some((t) => t.name === "Consulta")).toBe(false);

    expect(await archiveCaseType(typeId("Postventa"))).toEqual({ ok: true });
    expect(fake.rows("case_types").find((t) => t.name === "Postventa")!.archived_at).not.toBeNull();
  });

  it("un tipo al que otra regla programa gestiones no se borra", async () => {
    // Recompra la programa la regla de Venta (plantilla): se archiva aunque nunca tuvo gestiones.
    const result = await removeCaseType(typeId("Recompra"));
    expect(result).toMatchObject({ ok: true, outcome: "archive", message: expect.stringContaining("otra parte") });
  });
});

describe("reglas", () => {
  it("agregar, desactivar, reactivar y borrar", async () => {
    const venta = typeId("Venta");
    const before = fake.rows("case_rules").filter((r) => r.case_type_id === venta).length;
    const added = await addRule({
      caseTypeId: venta,
      rule: { trigger: "on_won", action: "schedule_case", scheduleCaseTypeId: typeId("Recompra"), scheduleMode: "days_after", days: 30 },
    });
    expect(added).toMatchObject({ ok: true });
    if (!("ok" in added)) throw new Error();
    const row = fake.rows("case_rules").find((r) => r.id === added.id)!;
    expect(row).toMatchObject({ trigger: "on_won", enabled: true, params: { case_type_id: typeId("Recompra"), days_after: 30 }, position: before });

    expect(await setRuleEnabled({ id: added.id, enabled: false })).toEqual({ ok: true });
    expect(fake.rows("case_rules").find((r) => r.id === added.id)!.enabled).toBe(false);
    expect(lastLog().meta).toMatchObject({ action: "rule_disabled" });
    expect(await setRuleEnabled({ id: added.id, enabled: true })).toEqual({ ok: true });
    expect(fake.rows("case_rules").find((r) => r.id === added.id)!.enabled).toBe(true);

    expect(await removeRule(added.id)).toEqual({ ok: true });
    expect(fake.rows("case_rules").some((r) => r.id === added.id)).toBe(false);
    expect(lastLog().meta).toMatchObject({ action: "rule_deleted" });
  });

  it("valida en el servidor lo que la interfaz ya valida", async () => {
    const venta = typeId("Venta");
    expect(await addRule({ caseTypeId: venta, rule: { trigger: "on_won", action: "set_contact_type" } })).toMatchObject({ error: expect.any(String) });
    expect(
      await addRule({ caseTypeId: venta, rule: { trigger: "on_stage", triggerStageId: stageId("Postventa", "Nueva"), action: "ask_key_date" } }),
    ).toMatchObject({ error: expect.any(String) });
  });
});

describe("tipos de contacto", () => {
  it("un solo tipo por defecto", async () => {
    const prospecto = contactTypeId("Prospecto");
    const cliente = contactTypeId("Cliente");
    expect(fake.rows("contact_types").filter((t) => t.is_default)).toHaveLength(1);
    expect(await setDefaultContactType(cliente)).toEqual({ ok: true });
    const defaults = fake.rows("contact_types").filter((t) => t.is_default);
    expect(defaults.map((t) => t.id)).toEqual([cliente]);
    expect(await setDefaultContactType(null)).toEqual({ ok: true });
    expect(fake.rows("contact_types").some((t) => t.is_default)).toBe(false);
    expect(await setDefaultContactType(prospecto)).toEqual({ ok: true });
    expect(fake.rows("contact_types").find((t) => t.id === prospecto)!.is_default).toBe(true);
    expect(lastLog().meta).toMatchObject({ action: "contact_type_default_changed" });
  });

  it("crear, renombrar y cambiar el color", async () => {
    const created = await createContactType({ name: "VIP", color: "#ff0000" });
    expect(created).toMatchObject({ ok: true });
    if (!("ok" in created)) throw new Error();
    expect(fake.rows("contact_types").find((t) => t.id === created.id)).toMatchObject({ name: "VIP", color: "#ff0000", position: 4, is_default: false });
    expect(await createContactType({ name: "vip" })).toEqual({ error: "Ya existe un tipo de contacto con ese nombre." });
    expect(await updateContactType({ id: created.id, name: "VIP oro", color: "#00ff00" })).toEqual({ ok: true });
    expect(fake.rows("contact_types").find((t) => t.id === created.id)).toMatchObject({ name: "VIP oro", color: "#00ff00" });
    expect(await updateContactType({ id: created.id, name: "Cliente" })).toEqual({ error: "Ya existe un tipo de contacto con ese nombre." });
  });

  it("archivar el de por defecto lo deja sin por defecto; reactivarlo no lo restituye", async () => {
    const prospecto = contactTypeId("Prospecto");
    expect(await archiveContactType(prospecto)).toEqual({ ok: true });
    expect(fake.rows("contact_types").find((t) => t.id === prospecto)).toMatchObject({ is_default: false });
    expect(fake.rows("contact_types").find((t) => t.id === prospecto)!.archived_at).not.toBeNull();
    expect(await setDefaultContactType(prospecto)).toMatchObject({ error: expect.any(String) });
  });

  it("con contactos se archiva; sin uso se borra; si una regla lo menciona, se archiva", async () => {
    const inactivo = contactTypeId("Inactivo");
    fake.seed("contacts", [{ workspace_id: WS, display_name: "Luis", contact_type_id: inactivo }]);
    expect(await removeContactType(inactivo)).toMatchObject({ ok: true, outcome: "archive", message: expect.stringContaining("historial") });
    expect(fake.rows("contact_types").some((t) => t.id === inactivo)).toBe(true);

    const nuevo = await createContactType({ name: "Temporal" });
    if (!("ok" in nuevo)) throw new Error();
    expect(await removeContactType(nuevo.id)).toMatchObject({ ok: true, outcome: "delete" });
    expect(fake.rows("contact_types").some((t) => t.id === nuevo.id)).toBe(false);

    // "Cliente" lo usa una regla de la plantilla (Venta ganada).
    expect(await removeContactType(contactTypeId("Cliente"))).toMatchObject({ ok: true, outcome: "archive", message: expect.stringContaining("otra parte") });
  });

  it("también cuenta como uso ser el tipo sugerido de un tipo de gestión", async () => {
    // "Prospecto" es el sugerido de Venta.
    expect(await removeContactType(contactTypeId("Prospecto"))).toMatchObject({ ok: true, outcome: "archive" });
  });
});

describe("etiqueta de la fecha clave", () => {
  it("se guarda sin perder el resto de la configuración y se registra", async () => {
    expect(await saveKeyDateLabel("  Vencimiento   de plan ")).toEqual({ ok: true, label: "Vencimiento de plan" });
    const settings = fake.rows("workspaces").find((w) => w.id === WS)!.settings as Record<string, unknown>;
    expect(settings).toMatchObject({ agent_visibility: "team", business_template: "ecommerce", key_date_label: "Vencimiento de plan" });
    expect(lastLog()).toMatchObject({ from_value: "Última compra", to_value: "Vencimiento de plan", meta: { action: "key_date_label_changed" } });
  });

  it("vacía se quita; demasiado larga se rechaza", async () => {
    expect(await saveKeyDateLabel("   ")).toEqual({ ok: true, label: "" });
    const settings = fake.rows("workspaces").find((w) => w.id === WS)!.settings as Record<string, unknown>;
    expect("key_date_label" in settings).toBe(false);
    expect(settings.agent_visibility).toBe("team");
    expect(await saveKeyDateLabel("x".repeat(101))).toMatchObject({ error: expect.any(String) });
  });
});
