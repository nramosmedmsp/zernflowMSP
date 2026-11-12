import { describe, expect, it } from "vitest";
import {
  boardHeadline,
  boardOpenStages,
  boardPermissions,
  boardSupportsTab,
  closeDropVerdict,
  groupByStage,
  moveTargets,
  resolveBoardType,
  sortByUrgency,
  stageDropVerdict,
  visibleTypeChips,
  type BoardCardState,
  type BoardTypeRules,
} from "./board-model";
import { parseCaseListParams, buildCasesHref } from "./case-filters";
import { STRICT_LOCK_MESSAGE } from "@/components/inbox/step-bar-model";

const st = (
  id: string,
  name: string,
  kind: "open" | "won" | "lost" | "resolved" = "open",
  extra: { requires?: "category" | "note" | "solution" | null; archived?: boolean; nextSteps?: { stageId: string | null; action: "remind_tomorrow" | null; label: string | null }[] } = {},
) => ({ id, name, kind, archived: extra.archived ?? false, guideText: null, nextSteps: extra.nextSteps ?? [], requires: extra.requires ?? null });

const venta = [st("s1", "Nuevo"), st("s2", "Asesorando"), st("s3", "Pedido enviado"), st("s4", "Esperando pago"), st("w", "Pagado", "won"), st("l", "No compró", "lost")];
const postventa = [
  st("p1", "Nueva", "open", { requires: "category" }),
  st("p2", "En gestión", "open", { requires: "solution" }),
  st("p3", "Esperando al cliente"),
  st("r", "Resuelta", "resolved"),
  st("x", "Sin solución", "lost"),
];

const rules = (stages: BoardTypeRules["stages"], extra: Partial<BoardTypeRules> = {}): BoardTypeRules => ({
  strictOrder: false,
  isProtected: false,
  hasCategories: true,
  stages,
  ...extra,
});
const card = (extra: Partial<BoardCardState> = {}): BoardCardState => ({
  status: "open",
  stageId: "s1",
  categoryId: null,
  assigneeId: "me",
  teamId: "t1",
  contactTeamId: null,
  solutionStatus: null,
  hasCloseRequest: false,
  ...extra,
});
const asesor = { userId: "me", isAdmin: false, supervisedTeamIds: [] as string[] };
const supervisor = { userId: "sup", isAdmin: false, supervisedTeamIds: ["t1"] };
const admin = { userId: "adm", isAdmin: true, supervisedTeamIds: [] as string[] };

describe("boardPermissions", () => {
  it("el asesor edita solo lo suyo; el supervisor, lo de su equipo; el administrador, todo", () => {
    expect(boardPermissions(asesor, card())).toEqual({ canEdit: true, canSupervise: false });
    expect(boardPermissions(asesor, card({ assigneeId: "otro" }))).toEqual({ canEdit: false, canSupervise: false });
    expect(boardPermissions(asesor, card({ assigneeId: null }))).toEqual({ canEdit: false, canSupervise: false });
    expect(boardPermissions(supervisor, card({ assigneeId: "otro" }))).toEqual({ canEdit: true, canSupervise: true });
    expect(boardPermissions(supervisor, card({ assigneeId: "otro", teamId: "t2" }))).toEqual({ canEdit: false, canSupervise: false });
    // También supervisa por el equipo del contacto.
    expect(boardPermissions(supervisor, card({ assigneeId: "otro", teamId: null, contactTeamId: "t1" })).canEdit).toBe(true);
    expect(boardPermissions(admin, card({ assigneeId: "otro", teamId: "t9" }))).toEqual({ canEdit: true, canSupervise: true });
  });
});

describe("stageDropVerdict", () => {
  const perms = (actor: typeof asesor, c = card()) => boardPermissions(actor, c);

  it("sin orden estricto un asesor puede ir a cualquier columna (adelante o atrás)", () => {
    const c = card({ stageId: "s2" });
    for (const target of ["s1", "s3", "s4"]) {
      expect(stageDropVerdict(c, target, perms(asesor, c), rules(venta)).ok).toBe(true);
    }
  });

  it("la columna actual no acepta", () => {
    const v = stageDropVerdict(card(), "s1", perms(asesor), rules(venta));
    expect(v).toMatchObject({ ok: false, reason: "current" });
  });

  it("orden estricto: el asesor queda bloqueado fuera de los pasos configurados, con el mensaje del candado", () => {
    const r = rules(venta, { strictOrder: true });
    const c = card({ stageId: "s1" });
    expect(stageDropVerdict(c, "s2", perms(asesor, c), r)).toMatchObject({ ok: true, jump: false });
    expect(stageDropVerdict(c, "s4", perms(asesor, c), r)).toEqual({ ok: false, reason: "locked", message: STRICT_LOCK_MESSAGE });
  });

  it("orden estricto: el supervisor y el administrador saltan, y el salto se marca para el historial", () => {
    const r = rules(venta, { strictOrder: true });
    const c = card({ stageId: "s1" });
    expect(stageDropVerdict(c, "s4", perms(supervisor, c), r)).toMatchObject({ ok: true, jump: true });
    expect(stageDropVerdict(c, "s4", perms(admin, c), r)).toMatchObject({ ok: true, jump: true });
    // Un paso configurado no es salto.
    expect(stageDropVerdict(c, "s2", perms(supervisor, c), r)).toMatchObject({ ok: true, jump: false });
  });

  it("orden estricto: el asesor puede volver un paso", () => {
    const r = rules(venta, { strictOrder: true });
    const c = card({ stageId: "s3" });
    expect(stageDropVerdict(c, "s2", perms(asesor, c), r).ok).toBe(true);
    expect(stageDropVerdict(c, "s1", perms(asesor, c), r)).toMatchObject({ reason: "locked" });
  });

  it("sin la gestión (no es suya) no se mueve", () => {
    const c = card({ assigneeId: "otro" });
    expect(stageDropVerdict(c, "s2", perms(asesor, c), rules(venta))).toMatchObject({ ok: false, reason: "no_edit" });
  });

  it("«Ver como» es solo lectura aunque tenga permisos", () => {
    expect(stageDropVerdict(card(), "s2", perms(admin), rules(venta), { readOnly: true })).toMatchObject({ ok: false, reason: "read_only" });
  });

  it("si la etapa pide categoría y falta, no avanza (dice qué falta) pero sí puede volver; el supervisor está exento", () => {
    const r = rules(postventa);
    const c = card({ stageId: "p1" });
    const v = stageDropVerdict(c, "p2", perms(asesor, c), r);
    expect(v).toMatchObject({ ok: false, reason: "requirement", requirement: "category" });
    expect(v.ok === false && v.message).toBe("Antes de ir a En gestión: elige la categoría");
    expect(stageDropVerdict({ ...c, categoryId: "cat" }, "p2", perms(asesor, c), r).ok).toBe(true);
    expect(stageDropVerdict(c, "p2", perms(supervisor, c), r).ok).toBe(true);
    // Sin categorías en el tipo no hay nada que pedir.
    expect(stageDropVerdict(c, "p2", perms(asesor, c), rules(postventa, { hasCategories: false })).ok).toBe(true);
  });

  it("si la etapa pide la solución, hace falta que esté registrada; volver atrás no lo pide", () => {
    const r = rules(postventa);
    const c = card({ stageId: "p2", categoryId: "cat" });
    expect(stageDropVerdict(c, "p3", perms(asesor, c), r)).toMatchObject({ ok: false, reason: "requirement", requirement: "solution" });
    expect(stageDropVerdict({ ...c, solutionStatus: "in_progress" }, "p3", perms(asesor, c), r).ok).toBe(true);
    expect(stageDropVerdict(c, "p1", perms(asesor, c), r).ok).toBe(true);
  });

  it("una gestión sin etapa no tiene candados ni requisitos", () => {
    const c = card({ stageId: null });
    expect(stageDropVerdict(c, "s3", perms(asesor, c), rules(venta, { strictOrder: true })).ok).toBe(true);
  });
});

describe("closeDropVerdict", () => {
  const perms = (actor: typeof asesor, c = card()) => boardPermissions(actor, c);

  it("acepta cada resultado final con su nombre", () => {
    expect(closeDropVerdict(card(), "w", perms(asesor), rules(venta))).toMatchObject({ ok: true, kind: "close", name: "Pagado", needsApproval: false });
    expect(closeDropVerdict(card(), "l", perms(asesor), rules(venta))).toMatchObject({ ok: true, name: "No compró" });
  });

  it("en un tipo protegido, «Sin solución» pide aprobación al asesor y no al supervisor", () => {
    const r = rules(postventa, { isProtected: true });
    expect(closeDropVerdict(card(), "x", perms(asesor), r)).toMatchObject({ ok: true, needsApproval: true });
    expect(closeDropVerdict(card(), "x", perms(supervisor), r)).toMatchObject({ ok: true, needsApproval: false });
    expect(closeDropVerdict(card(), "r", perms(asesor), r)).toMatchObject({ ok: true, needsApproval: false });
  });

  it("con un pedido de cierre pendiente no se puede pedir otro", () => {
    const r = rules(postventa, { isProtected: true });
    const v = closeDropVerdict(card({ hasCloseRequest: true }), "x", perms(asesor), r);
    expect(v).toMatchObject({ ok: false, reason: "pending_request" });
  });

  it("sin la gestión o en «Ver como» no se cierra", () => {
    const c = card({ assigneeId: "otro" });
    expect(closeDropVerdict(c, "w", perms(asesor, c), rules(venta))).toMatchObject({ reason: "no_edit" });
    expect(closeDropVerdict(card(), "w", perms(admin), rules(venta), { readOnly: true })).toMatchObject({ reason: "read_only" });
  });
});

describe("moveTargets (menú «Mover a…» y columnas al arrastrar)", () => {
  it("lista las etapas abiertas en orden y luego los resultados, cada uno con su veredicto", () => {
    const c = card({ stageId: "s2" });
    const targets = moveTargets(c, boardPermissions(asesor, c), rules(venta, { strictOrder: true }));
    expect(targets.map((t) => [t.group, t.name, t.number, t.verdict.ok ? "ok" : (t.verdict as { reason: string }).reason])).toEqual([
      ["stage", "Nuevo", 1, "ok"],
      ["stage", "Asesorando", 2, "current"],
      ["stage", "Pedido enviado", 3, "ok"],
      ["stage", "Esperando pago", 4, "locked"],
      ["close", "Pagado", null, "ok"],
      ["close", "No compró", null, "ok"],
    ]);
  });

  it("las etapas archivadas no son columnas", () => {
    const stages = [st("a", "A"), st("b", "B", "open", { archived: true }), st("c", "C"), st("f", "Fin", "won")];
    expect(boardOpenStages(stages).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("sin etapas finales, el único resultado es «Resuelta»", () => {
    const c = card({ stageId: "a" });
    const targets = moveTargets(c, boardPermissions(asesor, c), rules([st("a", "A"), st("c", "C")]));
    expect(targets.filter((t) => t.group === "close").map((t) => [t.name, t.stageId])).toEqual([["Resuelta", null]]);
  });
});

describe("agrupar y ordenar", () => {
  const NOW = new Date("2026-11-10T15:00:00.000Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  const u = (id: string, stageId: string | null, waitingH: number | null, extra: Record<string, unknown> = {}) => ({
    id,
    contactId: `c-${id}`,
    stageId,
    status: "open",
    openedAt: hoursAgo(50),
    waitingSince: waitingH === null ? null : hoursAgo(waitingH),
    nextActionAt: null,
    scheduledFor: null,
    closedAt: null,
    createdAt: hoursAgo(60),
    solutionStatus: null,
    solutionNote: null,
    solutionClockAt: null,
    deadlineHours: null,
    schedule: null,
    ...extra,
  });

  it("agrupa por etapa y devuelve todas las columnas aunque estén vacías", () => {
    const g = groupByStage([u("a", "s1", 1), u("b", "s2", 1), u("c", "s1", 2)], ["s1", "s2", "s3"], "open", NOW);
    expect([...g.keys()]).toEqual(["s1", "s2", "s3"]);
    expect(g.get("s1")!.map((c) => c.id).sort()).toEqual(["a", "c"]);
    expect(g.get("s3")).toEqual([]);
  });

  it("una gestión sin etapa o en una etapa que ya no es columna va a la primera", () => {
    const g = groupByStage([u("a", null, 1), u("b", "vieja", 1), u("c", "s2", 1)], ["s1", "s2"], "open", NOW);
    expect(g.get("s1")!.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(g.get("s2")!.map((c) => c.id)).toEqual(["c"]);
  });

  it("sin columnas no se pierde nada ni falla", () => {
    expect(groupByStage([u("a", "s1", 1)], [], "open", NOW).size).toBe(0);
  });

  it("dentro de la columna, lo más urgente primero: reclamo vencido, luego plazo corriendo, luego la espera más antigua", () => {
    const ordered = sortByUrgency(
      [
        u("espera-corta", "p1", 1),
        u("espera-larga", "p1", 30),
        u("plazo-corre", "p1", 2, { openedAt: hoursAgo(2), deadlineHours: 24 }),
        u("plazo-vencido", "p1", 1, { openedAt: hoursAgo(30), deadlineHours: 24 }),
      ],
      "open",
      NOW,
    );
    expect(ordered.map((c) => c.id)).toEqual(["plazo-vencido", "plazo-corre", "espera-larga", "espera-corta"]);
  });

  it("en Para hoy ordena por el próximo contacto más cercano", () => {
    const ordered = sortByUrgency(
      [u("b", "s1", 1, { nextActionAt: hoursAgo(-3) }), u("a", "s1", 1, { nextActionAt: hoursAgo(10) }), u("c", "s1", 1)],
      "today",
      NOW,
    );
    expect(ordered.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("el orden no depende del orden de entrada (estable por id en empates)", () => {
    const a = [u("x", "s1", 5), u("y", "s1", 5)];
    expect(sortByUrgency(a, "open", NOW).map((c) => c.id)).toEqual(sortByUrgency([...a].reverse(), "open", NOW).map((c) => c.id));
  });
});

describe("tipo elegido y chips", () => {
  const chips = [
    { id: "venta", name: "Venta", color: null, count: 0 },
    { id: "post", name: "Postventa", color: null, count: 4 },
    { id: "rec", name: "Recompra", color: null, count: 2 },
  ];
  it("usa el de la URL si es uno de los activos", () => {
    expect(resolveBoardType(chips, "rec")).toBe("rec");
  });
  it("si no hay o es inválido, el primero con gestiones; y si ninguno tiene, el primero", () => {
    expect(resolveBoardType(chips, "")).toBe("post");
    expect(resolveBoardType(chips, "borrado")).toBe("post");
    expect(resolveBoardType(chips, "none")).toBe("post");
    expect(resolveBoardType(chips.map((c) => ({ ...c, count: 0 })), "")).toBe("venta");
    expect(resolveBoardType([], "x")).toBeNull();
  });
  it("muestra los tipos con gestiones y siempre el elegido", () => {
    expect(visibleTypeChips(chips, "post").map((c) => c.id)).toEqual(["post", "rec"]);
    expect(visibleTypeChips(chips, "venta").map((c) => c.id)).toEqual(["venta", "post", "rec"]);
  });
  it("encabezado con singular y plural", () => {
    expect(boardHeadline(7, "Venta", "open")).toBe("7 gestiones abiertas de Venta");
    expect(boardHeadline(1, "Venta", "open")).toBe("1 gestión abierta de Venta");
    expect(boardHeadline(3, "Venta", "today")).toBe("3 gestiones de Venta para hoy");
    expect(boardHeadline(0, null, "open")).toBe("Sin gestiones");
  });
});

describe("parámetros de la URL del tablero", () => {
  it("view=board vale en Abiertas y Para hoy; en Programadas y Cerradas vuelve a Por cliente", () => {
    expect(parseCaseListParams({ view: "board" }).view).toBe("board");
    expect(parseCaseListParams({ view: "board", tab: "today" }).view).toBe("board");
    expect(parseCaseListParams({ view: "board", tab: "scheduled" }).view).toBe("client");
    expect(parseCaseListParams({ view: "board", tab: "closed" }).view).toBe("client");
    expect(parseCaseListParams({ view: "otra" }).view).toBe("client");
    expect(parseCaseListParams({ view: "case" }).view).toBe("case");
    expect(boardSupportsTab("open")).toBe(true);
    expect(boardSupportsTab("closed")).toBe(false);
  });
  it("recuerda el tipo elegido en la URL", () => {
    const id = "8f398456-79cd-4b32-88f0-d9f5f9e86a2b";
    const href = buildCasesHref({ view: "board", type: id });
    expect(href).toBe(`/dashboard/cases?view=board&type=${id}`);
    expect(parseCaseListParams(Object.fromEntries(new URL(href, "http://x").searchParams))).toMatchObject({ view: "board", type: id });
  });
});
