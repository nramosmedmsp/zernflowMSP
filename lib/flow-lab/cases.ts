// Motor de gestiones sobre el estado simulado. Reutiliza las funciones puras
// del motor real (routing, rules, dates, hours, decisions, no-reply-rules,
// off-hours-text, auto-template-params); lo que aquí se reescribe es solo la
// orquestación que en el motor real hace consultas a la base. La prueba de
// equivalencia (equivalence.test.ts) comprueba que ambos coinciden.

import { isWithinHours } from "@/lib/business-hours";
import { buildAutoTemplateParams, parseAutoTemplate } from "@/lib/cases/auto-template-params";
import { isDateString, parseScheduleAt } from "@/lib/cases/dates";
import {
  nextAutoTemplateStageId,
  pickSuggestedCaseTypeId,
  planActivation,
  resolveReopenStageId,
} from "@/lib/cases/decisions";
import { isOpenAt, nextOpeningFor, scheduleForTeam } from "@/lib/cases/hours";
import { isPendingNoReply, nextNoReplyThreshold, noReplyMinutes } from "@/lib/cases/no-reply-rules";
import { offHoursReplyDue, renderOffHoursReply } from "@/lib/cases/off-hours-text";
import {
  decideAssignment,
  pickAssignee,
  resolveTargetTeamId,
  type RoutingInput,
} from "@/lib/cases/routing";
import {
  CLOSE_TRIGGER,
  botOutboundPatch,
  humanOutboundPatch,
  inboundPatch,
  needsKeyDate,
  parseRule,
  planRules,
  shouldReopen,
  validateClose,
  type ParsedRule,
  type RuleEventContext,
  type RulePlan,
} from "@/lib/cases/rules";
import { demoTemplateText } from "@/lib/demo";
import { phoneDigits } from "@/lib/whatsapp-templates";
import { selectCaseTriggers } from "@/lib/flow-engine/case-trigger-match";
import type { OutcomeKind } from "@/lib/types/database";
import { activeTriggers, caseTypeName, contactTypeName, memberName, stageName, teamName } from "./catalog";
import type { Run } from "./run";
import { caseById, compareLatestOpen, latestOpenCase, newCaseTemplate, nextId } from "./state";
import type { CloseCaseInput, LabCase, LabCaseType } from "./types";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const MAX_NOTE_LENGTH = 5000;

function isError(value: unknown): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

// ── Eventos hacia los flujos ────────────────────────────────────────────────

/** case_stage_changed si la etapa cambió. */
export function emitStageChanged(
  run: Run,
  row: LabCase,
  fromStageId: string | null,
  toStageId: string | null,
  flowChain?: readonly string[],
) {
  if (fromStageId === toStageId) return;
  run.enqueue({
    type: "case_stage_changed",
    caseId: row.id,
    caseTypeId: row.caseTypeId,
    stageId: toStageId,
    ...(flowChain && flowChain.length > 0 ? { chain: [...flowChain] } : {}),
  });
}

export function emitCaseClosed(run: Run, row: LabCase, stageId: string | null, outcome: OutcomeKind) {
  run.enqueue({ type: "case_closed", caseId: row.id, caseTypeId: row.caseTypeId, stageId, outcome });
}

// ── Sellos y pausa del bot ──────────────────────────────────────────────────

/** Salida automática: solo sella last_outbound_at de las gestiones abiertas (o de `caseId`). */
export function stampBotOutbound(run: Run, params: { at?: string; caseId?: string | null } = {}) {
  const at = params.at ?? run.nowIso;
  for (const row of run.state.cases) {
    if (row.status !== "open") continue;
    if (params.caseId && row.id !== params.caseId) continue;
    Object.assign(row, patchCase(botOutboundPatch(at)));
    row.outboundOrder = nextOrder(run);
  }
}

/** Contador que ordena entradas y salidas que caen en el mismo instante simulado. */
function nextOrder(run: Run): number {
  run.state.counters.order = (run.state.counters.order ?? 0) + 1;
  return run.state.counters.order;
}

/**
 * ¿El último mensaje saliente de la gestión es posterior al último entrante? Lo que exige «cliente sin responder»
 * (cases_pending_no_reply en la base). Con el mismo instante manda el orden en que ocurrieron.
 */
export function outboundAfterInbound(row: LabCase): boolean {
  if (!row.lastOutboundAt) return false;
  if (!row.lastInboundAt) return true;
  const out = new Date(row.lastOutboundAt).getTime();
  const inn = new Date(row.lastInboundAt).getTime();
  if (out !== inn) return out > inn;
  return (row.outboundOrder ?? 0) > (row.inboundOrder ?? 0);
}

function patchCase(patch: Partial<Record<string, unknown>>): Partial<LabCase> {
  const map: Record<string, keyof LabCase> = {
    last_outbound_at: "lastOutboundAt",
    last_inbound_at: "lastInboundAt",
    waiting_since: "waitingSince",
    first_response_at: "firstResponseAt",
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) out[map[key] ?? key] = value;
  return out as Partial<LabCase>;
}

export function pauseAutomation(run: Run, why: string) {
  if (run.state.automationPaused) return;
  run.state.automationPaused = true;
  run.step("bot_paused", `El bot se pausa en esta conversación (${why}). Los mensajes del cliente ya no disparan flujos hasta que se reanude (los flujos de eventos de gestión sí corren), y se reanuda solo al no quedar ninguna gestión abierta.`, {
    level: "warning",
  });
}

/** Reanuda el bot si el contacto ya no tiene ninguna gestión abierta. */
export function resumeAutomationIfIdle(run: Run) {
  if (run.state.cases.some((c) => c.status === "open")) return;
  if (!run.state.automationPaused) return;
  run.state.automationPaused = false;
  run.step("bot_resumed", "No queda ninguna gestión abierta: el bot se reanuda en la conversación.", { level: "ok" });
}

// ── Reparto ─────────────────────────────────────────────────────────────────

function routingInput(
  run: Run,
  params: Pick<RoutingInput, "caseTypeId" | "routing" | "fixedTeamId" | "currentTeamId" | "excludeUserIds">,
): RoutingInput {
  const { catalog, state } = run;
  return {
    ...params,
    contactOwnerId: state.contact.ownerId,
    contactTeamId: state.contact.teamId,
    teams: catalog.teams.map((t) => ({ id: t.id, isDefault: t.isDefault, assignmentMode: t.assignmentMode })),
    teamMembers: catalog.teamMembers.map((m) => ({
      teamId: m.teamId,
      userId: m.userId,
      role: m.role,
      caseTypeIds: m.caseTypeIds,
    })),
    members: catalog.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      availability: state.members[m.userId]?.availability ?? m.availability,
      lastAssignedAt: state.members[m.userId]?.lastAssignedAt ?? m.lastAssignedAt,
    })),
    workspaceMode: catalog.workspaceMode,
  };
}

function routingFor(run: Run, caseType: LabCaseType | null, row: Pick<LabCase, "teamId">, currentTeamId: string | null) {
  return routingInput(run, {
    caseTypeId: caseType?.id ?? null,
    routing: caseType?.routing ?? "contact_owner",
    fixedTeamId: caseType?.fixedTeamId ?? null,
    currentTeamId,
  });
}

export type AssignOutcome =
  | { status: "assigned"; assigneeId: string; teamId: string | null; via: "owner" | "round_robin" | "least_load" }
  | { status: "already_assigned"; assigneeId: string }
  | { status: "unassigned"; reason: "manual" | "no_eligible" | "off_hours"; teamId: string | null }
  | { status: "skipped"; reason: "not_open" };

/** Marca de tiempo del reparto: estrictamente creciente aunque dos caigan en el mismo instante. */
function assignStamp(run: Run, at: string): string {
  run.state.counters.seq += 1;
  return new Date(new Date(at).getTime() + run.state.counters.seq).toISOString();
}

const VIA_TEXT = {
  owner: "es el responsable del contacto",
  round_robin: "reparto por turnos",
  least_load: "reparto por menor carga",
} as const;

/**
 * Reparto de una gestión abierta sin responsable (como assignCase del motor
 * real): equipo de destino, responsable del contacto o modo del equipo; fuera
 * de horario no se reparte.
 */
export function assignCase(run: Run, row: LabCase, opts: { at?: Date; exclude?: readonly string[]; silent?: boolean } = {}): AssignOutcome {
  if (row.status !== "open") return { status: "skipped", reason: "not_open" };
  if (row.assigneeId) return { status: "already_assigned", assigneeId: row.assigneeId };
  const { catalog, state, index } = run;
  const at = opts.at ?? run.now;
  const type = row.caseTypeId ? (index.caseTypeById.get(row.caseTypeId) ?? null) : null;
  const decision = decideAssignment({ ...routingFor(run, type, row, row.teamId), excludeUserIds: opts.exclude });

  if (decision.teamId !== row.teamId) {
    const before = row.teamId;
    row.teamId = decision.teamId;
    run.step("case_team_changed", `La gestión va al equipo «${teamName(catalog, decision.teamId)}» según el tipo de gestión y el contacto.`, {
      caseId: row.id,
      data: { from: before, to: decision.teamId },
    });
  }

  // Fuera de horario no se reparte: el cron lo hace al abrir.
  if ((decision.kind === "owner" || decision.kind === "pick") && !isOpenAt(index.hours, decision.teamId, at)) {
    run.step(
      "case_unassigned",
      `Fuera del horario de «${teamName(catalog, decision.teamId)}»: la gestión queda sin asignar hasta que abra.`,
      { caseId: row.id, level: "warning", data: { reason: "off_hours" } },
    );
    return { status: "unassigned", reason: "off_hours", teamId: decision.teamId };
  }

  let assigned: { assigneeId: string; via: "owner" | "round_robin" | "least_load" } | null = null;
  if (decision.kind === "owner" || decision.kind === "pick") {
    // Réplica de assign_case_pick: entre los candidatos disponibles.
    const candidates = decision.kind === "owner" ? [decision.userId] : decision.candidates;
    const mode = decision.kind === "owner" ? "round_robin" : decision.mode;
    const members = candidates.filter((id) => (state.members[id]?.availability ?? "away") === "available");
    const pick = pickAssignee(
      members.map((userId) => ({
        userId,
        lastAssignedAt: state.members[userId]?.lastAssignedAt ?? null,
        openCount: state.cases.filter((c) => c.assigneeId === userId && c.status === "open").length,
      })),
      mode,
    );
    if (pick) {
      row.assigneeId = pick;
      row.assignedAt = run.nowIso;
      state.members[pick] = { ...(state.members[pick] ?? { availability: "available" }), lastAssignedAt: assignStamp(run, run.nowIso) };
      assigned = { assigneeId: pick, via: decision.kind === "owner" ? "owner" : mode };
    }
  }

  if (assigned) {
    run.ok("case_assigned", `La gestión se asigna a ${memberName(catalog, assigned.assigneeId)} (${VIA_TEXT[assigned.via]}).`, {
      caseId: row.id,
      data: { assigneeId: assigned.assigneeId, via: assigned.via, teamId: decision.teamId },
    });
    // El responsable del contacto se fija con el primer reparto "al responsable".
    if (!state.contact.ownerId && (type?.routing ?? "contact_owner") === "contact_owner") {
      state.contact.ownerId = assigned.assigneeId;
      run.step("contact_changed", `${memberName(catalog, assigned.assigneeId)} queda como responsable del contacto.`, {
        data: { field: "owner" },
      });
    }
    return { status: "assigned", assigneeId: assigned.assigneeId, teamId: decision.teamId, via: assigned.via };
  }

  const reason = decision.kind === "manual" ? "manual" : "no_eligible";
  if (!opts.silent) {
    run.step(
      "case_unassigned",
      reason === "manual"
        ? "El reparto de este equipo es manual: la gestión queda por asignar."
        : "No hay asesores disponibles que atiendan este tipo de gestión: la gestión queda sin asignar.",
      { caseId: row.id, level: "warning", data: { reason } },
    );
  }
  return { status: "unassigned", reason, teamId: decision.teamId };
}

// ── Mensaje entrante ────────────────────────────────────────────────────────

/**
 * Mensaje entrante (como handleInbound del motor real): usa la gestión abierta
 * más reciente; si no hay, reabre la cerrada hace menos de 24 h o abre una
 * nueva; sella la entrada, reparte y, fuera de horario, responde.
 */
export function handleInbound(run: Run, at: string): { row: LabCase; opened: boolean; reopened: boolean } {
  const { state, catalog, index } = run;
  let row = latestOpenCase(state);
  let opened = false;
  let reopened = false;

  // Reapertura dentro de 24 h.
  if (!row) {
    const lastClosed = state.cases
      .filter((c) => c.status === "won" || c.status === "lost" || c.status === "resolved")
      .sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime())[0];
    if (lastClosed && shouldReopen({ status: lastClosed.status, closed_at: lastClosed.closedAt }, at)) {
      const type = lastClosed.caseTypeId ? index.caseTypeById.get(lastClosed.caseTypeId) : undefined;
      const stageId = type
        ? resolveReopenStageId(lastClosed.closedFromStageId, type.stages.filter((s) => s.kind === "open"))
        : null;
      const finalStage = lastClosed.stageId;
      Object.assign(lastClosed, {
        status: "open",
        stageId,
        closedAt: null,
        outcomeReasonId: null,
        lastInboundAt: at,
        waitingSince: at,
      } satisfies Partial<LabCase>);
      row = lastClosed;
      reopened = true;
      run.ok("case_reopened", `El cliente escribe dentro de las 24 h del cierre: se reabre la gestión «${caseTypeName(catalog, row.caseTypeId)}» en la etapa «${stageName(catalog, stageId)}».`, {
        caseId: row.id,
      });
      emitStageChanged(run, row, finalStage, row.stageId);
    }
  }

  // Gestión nueva.
  if (!row) {
    let contactTypeId = state.contact.contactTypeId;
    if (!contactTypeId) {
      const def = catalog.contactTypes.find((t) => t.isDefault);
      if (def) {
        state.contact.contactTypeId = def.id;
        contactTypeId = def.id;
        run.step("contact_changed", `El contacto no tenía tipo: se le pone el de por defecto, «${def.name}».`, {
          data: { field: "contact_type", to: def.id },
        });
      }
    }
    const caseTypeId = pickSuggestedCaseTypeId(
      catalog.caseTypes.map((t) => ({ id: t.id, position: t.position, suggested_for_contact_type_ids: t.suggestedForContactTypeIds })),
      contactTypeId,
    );
    const type = caseTypeId ? index.caseTypeById.get(caseTypeId) : undefined;
    const stageId = type ? firstOpenStageId(type) : null;
    const fresh = newCaseTemplate(nextId(state, "case"), at);
    Object.assign(fresh, {
      caseTypeId,
      stageId,
      origin: "inbound",
      openedAt: at,
      lastInboundAt: at,
      waitingSince: at,
    } satisfies Partial<LabCase>);
    state.cases.push(fresh);
    row = fresh;
    opened = true;
    run.ok(
      "case_opened",
      caseTypeId
        ? `Se abre una gestión nueva «${type!.name}» (tipo sugerido para ${contactTypeName(catalog, contactTypeId)}), en la etapa «${stageName(catalog, stageId)}».`
        : "Se abre una gestión nueva sin clasificar (ningún tipo de gestión se sugiere para este tipo de contacto).",
      { caseId: row.id, data: { caseTypeId, stageId } },
    );
    if (caseTypeId) runEventRules(run, row, { trigger: "on_open", stageId: row.stageId, categoryId: null, outcomeReasonId: null });
    // Los flujos «Gestión nueva» corren con el tipo de contacto que quedó tras las reglas.
    run.enqueue({ type: "case_opened", caseId: row.id, caseTypeId: row.caseTypeId, stageId: row.stageId, contactTypeId: state.contact.contactTypeId });
  }

  // Sellos.
  row.inboundOrder = nextOrder(run);
  if (!opened && !reopened) {
    Object.assign(row, patchCase(inboundPatch({ waiting_since: row.waitingSince }, at)));
    run.step("case_reused", `Se usa la gestión abierta «${caseTypeName(catalog, row.caseTypeId)}» (etapa «${stageName(catalog, row.stageId)}»). Se sella el mensaje del cliente y empieza su espera.`, {
      caseId: row.id,
    });
  }

  // Reparto.
  if (!row.assigneeId) assignCase(run, row, { at: new Date(at) });

  // Respuesta fuera de horario.
  sendOffHoursReply(run, row, at);

  return { row, opened, reopened };
}

function firstOpenStageId(type: LabCaseType): string | null {
  return [...type.stages].filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)[0]?.id ?? null;
}

// ── Respuesta fuera de horario ──────────────────────────────────────────────

export function sendOffHoursReply(run: Run, row: LabCase, at: string) {
  const { index, state, catalog } = run;
  if (row.status !== "open") return;
  const reply = index.hours.offHoursReply;
  if (!reply?.enabled || !reply.text) return;

  const schedule = scheduleForTeam(index.hours, row.teamId);
  if (isWithinHours(at, schedule.hours, schedule.holidays)) return;
  if (!offHoursReplyDue(row.offHoursReplySentAt, reply.min_hours_between, at)) {
    run.step("off_hours_reply", "Fuera de horario, pero ya se envió la respuesta automática en esta gestión: no se repite.", {
      caseId: row.id,
    });
    return;
  }
  row.offHoursReplySentAt = at;
  const now = new Date(at);
  const text = renderOffHoursReply(reply.text, {
    contactName: state.contact.name,
    workspaceName: index.hours.workspaceName,
    teamName: row.teamId ? index.hours.teamNames.get(row.teamId) : null,
    opening: nextOpeningFor(index.hours, row.teamId, now),
    now,
  });
  const message = run.addMessage({ author: "bot", kind: "text", text, authorName: "Respuesta fuera de horario" });
  Object.assign(row, patchCase(botOutboundPatch(at)));
  row.outboundOrder = nextOrder(run);
  run.ok("off_hours_reply", `Fuera del horario de «${teamName(catalog, row.teamId)}»: se envía la respuesta automática.`, {
    caseId: row.id,
    messageId: message.id,
  });
}

// ── Cambios de la gestión ───────────────────────────────────────────────────

function activeCase(run: Run, row: LabCase | null): Result<{ row: LabCase }> {
  if (!row) return { error: "La gestión no existe." };
  if (row.status !== "open" && row.status !== "scheduled") return { error: "La gestión ya está cerrada." };
  return { ok: true, row };
}

/** Cambia la etapa (solo etapas abiertas: para cerrar se usa closeCase). */
export function changeStage(run: Run, row: LabCase, stageId: string, flowChain?: readonly string[]): Result {
  const active = activeCase(run, row);
  if (isError(active)) return active;
  if (!row.caseTypeId) return { error: "Clasifica la gestión antes de cambiar la etapa." };
  if (row.stageId === stageId) {
    run.step("info", `La gestión ya está en la etapa «${stageName(run.catalog, stageId)}»: no cambia nada.`, { caseId: row.id });
    return { ok: true };
  }
  const type = run.index.caseTypeById.get(row.caseTypeId);
  const stage = type?.stages.find((s) => s.id === stageId);
  if (!stage) return { error: "La etapa no pertenece a este tipo de gestión." };
  if (stage.kind !== "open") return { error: "Para ganar, perder o resolver la gestión usa Cerrar." };

  const from = row.stageId;
  row.stageId = stage.id;
  run.ok("case_stage_changed", `La gestión pasa de «${stageName(run.catalog, from)}» a «${stage.name}».`, {
    caseId: row.id,
    data: { from, to: stage.id },
  });
  emitStageChanged(run, row, from, stage.id, flowChain);
  runEventRules(run, row, { trigger: "on_stage", stageId: stage.id, categoryId: row.categoryId, outcomeReasonId: null });
  return { ok: true };
}

/** Cambia el tipo de gestión (primera etapa del tipo nuevo, sin categoría; puede cambiar de equipo). */
export function classifyCase(run: Run, row: LabCase, caseTypeId: string, flowChain?: readonly string[]): Result<{ rerouted: boolean }> {
  const active = activeCase(run, row);
  if (isError(active)) return active;
  if (row.caseTypeId === caseTypeId) {
    run.step("info", `La gestión ya es de tipo «${caseTypeName(run.catalog, caseTypeId)}»: no cambia nada.`, { caseId: row.id });
    return { ok: true, rerouted: false };
  }
  const type = run.index.caseTypeById.get(caseTypeId);
  if (!type) return { error: "El tipo de gestión no existe o está archivado." };
  const stageId = firstOpenStageId(type);

  let rerouted = false;
  let newTeam = row.teamId;
  if (row.status === "open") {
    const target = resolveTargetTeamId(routingFor(run, type, row, null));
    if (target !== row.teamId) {
      rerouted = true;
      newTeam = target;
    }
  }

  const before = { type: row.caseTypeId, stage: row.stageId, team: row.teamId };
  row.caseTypeId = type.id;
  row.stageId = stageId;
  row.categoryId = null;
  if (rerouted) {
    row.teamId = newTeam;
    row.assigneeId = null;
  }
  run.ok("case_classified", `La gestión se clasifica como «${type.name}» (antes: ${caseTypeName(run.catalog, before.type)}), en la etapa «${stageName(run.catalog, stageId)}».`, {
    caseId: row.id,
    data: { from: before.type, to: type.id },
  });
  if (rerouted) {
    run.step("case_team_changed", `Cambia el equipo de destino: «${teamName(run.catalog, newTeam)}». La gestión queda sin responsable y se reparte de nuevo.`, {
      caseId: row.id,
      data: { from: before.team, to: newTeam },
    });
  }
  emitStageChanged(run, row, before.stage, stageId, flowChain);
  if (before.type === null && row.status === "open") {
    runEventRules(run, row, { trigger: "on_open", stageId, categoryId: null, outcomeReasonId: null });
  }
  if (row.status === "open" && (rerouted || !row.assigneeId)) assignCase(run, row);
  return { ok: true, rerouted };
}

/** Fija la categoría (del mismo tipo). */
export function setCategory(run: Run, row: LabCase, categoryId: string | null): Result {
  const active = activeCase(run, row);
  if (isError(active)) return active;
  if (row.categoryId === categoryId) return { ok: true };
  if (categoryId) {
    if (!row.caseTypeId) return { error: "Clasifica la gestión antes de elegir una categoría." };
    const type = run.index.caseTypeById.get(row.caseTypeId);
    if (!type?.categories.some((c) => c.id === categoryId)) return { error: "La categoría no pertenece a este tipo de gestión." };
  }
  const name = categoryId ? run.index.caseTypeById.get(row.caseTypeId!)!.categories.find((c) => c.id === categoryId)!.name : "ninguna";
  row.categoryId = categoryId;
  run.ok("case_category_changed", `La categoría de la gestión pasa a «${name}».`, { caseId: row.id, data: { to: categoryId } });
  return { ok: true };
}

/** Asigna a una persona, o devuelve a la cola (`assigneeId` null). */
export function assignTo(run: Run, row: LabCase, assigneeId: string | null, enforceTeam = true): Result {
  const active = activeCase(run, row);
  if (isError(active)) return active;
  if (row.assigneeId === assigneeId) return { ok: true };
  if (assigneeId) {
    if (!run.index.memberById.has(assigneeId)) return { error: "La persona no es miembro de este espacio de trabajo." };
    if (row.teamId && enforceTeam) {
      const inTeam = run.catalog.teamMembers.some((m) => m.teamId === row.teamId && m.userId === assigneeId);
      if (!inTeam) return { error: "La persona no pertenece al equipo de esta gestión." };
    }
  }
  const from = row.assigneeId;
  row.assigneeId = assigneeId;
  row.assignedAt = assigneeId ? run.nowIso : null;
  if (assigneeId) {
    run.ok("case_assigned", `La gestión se asigna a ${memberName(run.catalog, assigneeId)} (a mano).`, {
      caseId: row.id,
      data: { from, to: assigneeId, via: "manual" },
    });
    run.state.members[assigneeId] = {
      ...(run.state.members[assigneeId] ?? { availability: "available" }),
      lastAssignedAt: assignStamp(run, run.nowIso),
    };
    // Si el contacto no tiene responsable y el destino es "al responsable", lo fija.
    const type = row.caseTypeId ? run.index.caseTypeById.get(row.caseTypeId) : null;
    if ((type?.routing ?? "contact_owner") === "contact_owner" && !run.state.contact.ownerId) {
      run.state.contact.ownerId = assigneeId;
      run.step("contact_changed", `${memberName(run.catalog, assigneeId)} queda como responsable del contacto.`, { data: { field: "owner" } });
    }
  } else {
    run.step("case_unassigned", "La gestión vuelve a la cola, sin responsable.", { caseId: row.id, level: "warning", data: { from } });
  }
  return { ok: true };
}

/** Cambia el equipo; con `assigneeId` la asigna a esa persona; sin él se reparte en el equipo nuevo. */
export function transferCase(run: Run, row: LabCase, teamId: string | null, assigneeId: string | null = null): Result {
  const active = activeCase(run, row);
  if (isError(active)) return active;
  if (teamId && !run.index.teamById.has(teamId)) return { error: "El equipo no existe o está archivado." };
  if (assigneeId) {
    if (!run.index.memberById.has(assigneeId)) return { error: "La persona no es miembro de este espacio de trabajo." };
    if (teamId && !run.catalog.teamMembers.some((m) => m.teamId === teamId && m.userId === assigneeId)) {
      return { error: "La persona no pertenece a ese equipo." };
    }
  }
  if (row.teamId === teamId && row.assigneeId === assigneeId) return { ok: true };
  const before = { team: row.teamId, assignee: row.assigneeId };
  row.teamId = teamId;
  row.assigneeId = assigneeId;
  row.assignedAt = assigneeId ? run.nowIso : null;
  run.ok("case_team_changed", `La gestión se transfiere al equipo «${teamName(run.catalog, teamId)}».`, {
    caseId: row.id,
    data: { from: before.team, to: teamId },
  });
  if (assigneeId && assigneeId !== before.assignee) {
    run.ok("case_assigned", `La gestión se asigna a ${memberName(run.catalog, assigneeId)}.`, { caseId: row.id, data: { to: assigneeId, via: "transfer" } });
    run.state.members[assigneeId] = {
      ...(run.state.members[assigneeId] ?? { availability: "available" }),
      lastAssignedAt: assignStamp(run, run.nowIso),
    };
  } else if (!assigneeId && row.status === "open") {
    assignCase(run, row);
  }
  return { ok: true };
}

/** Nota interna (la del nodo Atención humana es del sistema, sin autor). */
export function addSystemNote(run: Run, row: LabCase, body: string) {
  const text = body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!text) return;
  row.notes.push({ at: run.nowIso, body: text, authorId: null });
  run.step("case_note", `Nota interna en la gestión: «${text}»`, { caseId: row.id });
}

// ── Gestión del evento / destino de un flujo ────────────────────────────────

/** La gestión del evento si sigue abierta o programada; si no, la abierta más reciente. */
export function findTargetCase(run: Run, caseIdFromEvent: string | undefined): LabCase | null {
  const fromEvent = caseById(run.state, caseIdFromEvent);
  if (fromEvent && (fromEvent.status === "open" || fromEvent.status === "scheduled")) return fromEvent;
  return latestOpenCase(run.state);
}

/**
 * Gestión sobre la que actúa un nodo. Si el contacto no tiene una abierta,
 * abre una como lo haría un mensaje entrante: con el tipo pedido o el sugerido,
 * en su primera etapa y con reparto automático.
 */
export function ensureOpenCase(
  run: Run,
  variables: Record<string, string> | undefined,
  caseIdVariable: string,
  wantedCaseTypeId?: string | null,
): Result<{ row: LabCase }> {
  const existing = findTargetCase(run, variables?.[caseIdVariable]);
  if (existing) return { ok: true, row: existing };
  const { state, catalog, index } = run;
  const caseTypeId =
    wantedCaseTypeId ??
    pickSuggestedCaseTypeId(
      catalog.caseTypes.map((t) => ({ id: t.id, position: t.position, suggested_for_contact_type_ids: t.suggestedForContactTypeIds })),
      state.contact.contactTypeId,
    );
  const type = caseTypeId ? index.caseTypeById.get(caseTypeId) : undefined;
  if (caseTypeId && !type) return { error: "El tipo de gestión no existe o está archivado." };
  const stageId = type ? firstOpenStageId(type) : null;
  const team = resolveTargetTeamId(routingFor(run, type ?? null, { teamId: null }, null));
  const row = newCaseTemplate(nextId(state, "case"), run.nowIso);
  Object.assign(row, { caseTypeId: type?.id ?? null, stageId, origin: "manual", openedAt: run.nowIso, teamId: team } satisfies Partial<LabCase>);
  state.cases.push(row);
  run.ok("case_opened", `No había gestión abierta: se abre una «${caseTypeName(catalog, row.caseTypeId)}» en la etapa «${stageName(catalog, stageId)}».`, {
    caseId: row.id,
  });
  if (type) runEventRules(run, row, { trigger: "on_open", stageId, categoryId: null, outcomeReasonId: null });
  assignCase(run, row);
  if (variables) variables[caseIdVariable] = row.id;
  return { ok: true, row };
}

// ── Reglas ──────────────────────────────────────────────────────────────────

function parsedRules(type: LabCaseType | null | undefined): ParsedRule[] {
  return (type?.rules ?? []).map(parseRule).filter((r): r is ParsedRule => r !== null);
}

function countWins(run: Run, excludeCaseId: string): number {
  return run.state.cases.filter((c) => c.status === "won" && c.id !== excludeCaseId).length;
}

/** Reglas de apertura o de cambio de etapa (no piden la fecha clave: eso solo se puede al cerrar). */
export function runEventRules(run: Run, row: LabCase, ctx: Omit<RuleEventContext, "contactTypeId">) {
  const type = row.caseTypeId ? run.index.caseTypeById.get(row.caseTypeId) : null;
  const rules = parsedRules(type).filter((r) => r.action !== "ask_key_date");
  if (rules.length === 0) return;
  const plan = planRules({
    rules,
    ctx: { ...ctx, contactTypeId: run.state.contact.contactTypeId },
    wonCount: countWins(run, row.id) + (row.status === "won" ? 1 : 0),
    now: run.now,
    keyDate: run.state.contact.keyDate,
  });
  if (plan.matchedRuleIds.length === 0) return;
  applyRulePlan(run, plan, row, null);
}

/** Crea la gestión programada, o mueve la fecha de una programada del mismo tipo (dos ventas seguidas no dejan dos recompras). */
export function scheduleCase(run: Run, params: { caseTypeId: string; scheduledFor: string; origin?: "proactive" | "manual" }) {
  const { state, catalog, index } = run;
  const existing = state.cases
    .filter((c) => c.status === "scheduled" && c.caseTypeId === params.caseTypeId)
    .sort((a, b) => new Date(a.scheduledFor ?? 0).getTime() - new Date(b.scheduledFor ?? 0).getTime())[0];
  const label = new Date(params.scheduledFor);
  if (existing) {
    const from = existing.scheduledFor;
    existing.scheduledFor = params.scheduledFor;
    run.ok("case_scheduled", `Ya había una «${caseTypeName(catalog, params.caseTypeId)}» programada: se mueve a ${formatLima(label)}.`, {
      caseId: existing.id,
      data: { from, to: params.scheduledFor, rescheduled: true },
    });
    return { caseId: existing.id, rescheduled: true };
  }
  const type = index.caseTypeById.get(params.caseTypeId);
  const row = newCaseTemplate(nextId(state, "case"), run.nowIso);
  Object.assign(row, {
    caseTypeId: params.caseTypeId,
    stageId: type ? firstOpenStageId(type) : null,
    status: "scheduled",
    origin: params.origin ?? "proactive",
    scheduledFor: params.scheduledFor,
  } satisfies Partial<LabCase>);
  state.cases.push(row);
  run.ok("case_scheduled", `Se programa una gestión «${caseTypeName(catalog, params.caseTypeId)}» para ${formatLima(label)}.`, {
    caseId: row.id,
    data: { to: params.scheduledFor },
  });
  return { caseId: row.id, rescheduled: false };
}

/** "lun 12/10/2026 09:00" (hora de Lima). */
export function formatLima(date: Date): string {
  const lima = new Date(date.getTime() - 5 * 3_600_000);
  const day = lima.toISOString().slice(0, 10).split("-").reverse().join("/");
  return `${day} ${lima.toISOString().slice(11, 16)} (Lima)`;
}

export interface RuleEffectsSummary {
  contactType?: { from: string | null; to: string };
  keyDate?: { from: string | null; to: string };
  scheduled: { caseId: string; caseTypeId: string; scheduledFor: string; rescheduled: boolean }[];
  skipped: { ruleId: string; reason: "missing_key_date" | "invalid_case_type" | "invalid_contact_type" }[];
}

/** Aplica el plan de reglas: tipo de contacto, fecha clave y gestiones programadas. */
export function applyRulePlan(run: Run, plan: RulePlan, row: LabCase, keyDate: string | null | undefined): RuleEffectsSummary {
  const { state, catalog, index } = run;
  const effects: RuleEffectsSummary = { scheduled: [], skipped: [] };

  if (plan.askKeyDate && keyDate && keyDate !== state.contact.keyDate) {
    effects.keyDate = { from: state.contact.keyDate, to: keyDate };
    state.contact.keyDate = keyDate;
    run.ok("rule_applied", `Regla «${plan.askKeyDate.label}»: la fecha clave del contacto pasa a ${keyDate.split("-").reverse().join("/")}.`, {
      caseId: row.id,
      data: { field: "key_date", to: keyDate },
    });
  }

  if (plan.contactTypeId) {
    if (!index.contactTypeById.has(plan.contactTypeId)) {
      effects.skipped.push({ ruleId: plan.matchedRuleIds[0] ?? "", reason: "invalid_contact_type" });
      run.warn("Una regla quiere cambiar el tipo de contacto, pero ese tipo no existe o está archivado: se omite.");
    } else {
      effects.contactType = { from: state.contact.contactTypeId, to: plan.contactTypeId };
      state.contact.contactTypeId = plan.contactTypeId;
      run.ok("rule_applied", `Regla de la gestión: el contacto pasa a ser «${contactTypeName(catalog, plan.contactTypeId)}».`, {
        caseId: row.id,
        data: { field: "contact_type", to: plan.contactTypeId },
      });
    }
  }

  for (const s of plan.schedules) {
    if (!s.scheduledFor) {
      effects.skipped.push({ ruleId: s.ruleId, reason: "missing_key_date" });
      run.warn("Una regla quiere programar una gestión según la fecha clave, pero el contacto no tiene fecha clave: no se programa nada.");
      continue;
    }
    if (!index.caseTypeById.has(s.caseTypeId)) {
      effects.skipped.push({ ruleId: s.ruleId, reason: "invalid_case_type" });
      run.warn("Una regla quiere programar una gestión de un tipo que no existe o está archivado: se omite.");
      continue;
    }
    const result = scheduleCase(run, { caseTypeId: s.caseTypeId, scheduledFor: s.scheduledFor });
    effects.scheduled.push({ ...result, caseTypeId: s.caseTypeId, scheduledFor: s.scheduledFor });
  }
  return effects;
}

// ── Cierre ──────────────────────────────────────────────────────────────────

interface PreparedClose {
  row: LabCase;
  type: LabCaseType | null;
  kind: OutcomeKind;
  stageId: string | null;
  outcomeReasonId: string | null;
  categoryId: string | null;
  rules: ParsedRule[];
  ctx: RuleEventContext;
  wonCount: number;
  askKeyDate: { label: string } | null;
  requires: { category: boolean; outcomeReason: boolean };
}

function prepareClose(run: Run, input: CloseCaseInput, preview: boolean): Result<{ prepared: PreparedClose }> {
  const row = input.caseId ? caseById(run.state, input.caseId) : latestOpenCase(run.state);
  if (!row) return { error: "No hay una gestión abierta para cerrar." };
  if (row.status !== "open") {
    return { error: row.status === "scheduled" ? "La gestión está programada; todavía no se puede cerrar." : "La gestión ya está cerrada." };
  }
  const type = row.caseTypeId ? (run.index.caseTypeById.get(row.caseTypeId) ?? null) : null;
  if (row.caseTypeId && !type) return { error: "El tipo de la gestión no pertenece a este espacio." };

  const validation = validateClose({
    caseType: type
      ? {
          require_category: preview ? false : type.requireCategory,
          require_outcome_reason: preview ? false : type.requireOutcomeReason,
        }
      : null,
    stages: (type?.stages ?? []).map((s) => ({ ...s, archived_at: null })),
    reasons: (type?.reasons ?? []).map((r) => ({ ...r, archived_at: null })),
    categories: (type?.categories ?? []).map((c) => ({ id: c.id, archived_at: null })),
    currentCategoryId: row.categoryId,
    request: {
      stageId: input.stageId,
      kind: input.kind,
      outcomeReasonId: input.outcomeReasonId,
      categoryId: input.categoryId,
    },
  });
  if (!validation.ok) return { error: validation.error };

  const rules = parsedRules(type);
  const ctx: RuleEventContext = {
    trigger: CLOSE_TRIGGER[validation.kind],
    stageId: validation.stageId,
    categoryId: validation.categoryId,
    outcomeReasonId: validation.outcomeReasonId,
    contactTypeId: run.state.contact.contactTypeId,
  };
  const wins = rules.length > 0 ? countWins(run, row.id) : 0;
  return {
    ok: true,
    prepared: {
      row,
      type,
      kind: validation.kind,
      stageId: validation.stageId,
      outcomeReasonId: validation.outcomeReasonId,
      categoryId: validation.categoryId,
      rules,
      ctx,
      wonCount: wins + (validation.kind === "won" ? 1 : 0),
      askKeyDate: needsKeyDate(rules, ctx),
      requires: {
        category: !!type?.requireCategory,
        outcomeReason:
          !!type?.requireOutcomeReason && (type?.reasons ?? []).some((r) => r.kind === validation.kind),
      },
    },
  };
}

export interface LabClosePreview {
  kind: OutcomeKind;
  stageId: string | null;
  requires: { category: boolean; outcomeReason: boolean };
  /** Hay que pedir la fecha clave (con la actual del contacto para precargar). */
  askKeyDate: { label: string; current: string | null } | null;
  contactType: { from: string | null; to: string } | null;
  schedules: { caseTypeId: string; caseTypeName: string; scheduledFor: string | null; basis: string; days: number; missingKeyDate: boolean }[];
}

/** Vista previa del cierre (como previewClose): resultado, fecha clave, cambio de tipo y gestiones que se programarían. No cambia nada. */
export function previewClose(run: Run, input: CloseCaseInput): Result<{ preview: LabClosePreview }> {
  const prepared = prepareClose(run, input, true);
  if (isError(prepared)) return prepared;
  const p = prepared.prepared;
  const keyDate = p.askKeyDate && isDateString(input.keyDate) ? input.keyDate : run.state.contact.keyDate;
  const plan = planRules({
    rules: p.rules,
    ctx: p.ctx,
    wonCount: p.wonCount,
    now: run.now,
    keyDate,
    overrides: { scheduleAt: input.scheduleOverride?.scheduleAt, skipSchedule: input.scheduleOverride?.skip },
  });
  return {
    ok: true,
    preview: {
      kind: p.kind,
      stageId: p.stageId,
      requires: p.requires,
      askKeyDate: p.askKeyDate ? { label: p.askKeyDate.label, current: run.state.contact.keyDate } : null,
      contactType: plan.contactTypeId !== undefined ? { from: run.state.contact.contactTypeId, to: plan.contactTypeId } : null,
      schedules: plan.schedules.map((s) => ({
        caseTypeId: s.caseTypeId,
        caseTypeName: caseTypeName(run.catalog, s.caseTypeId),
        scheduledFor: s.scheduledFor,
        basis: s.basis,
        days: s.days,
        missingKeyDate: s.missingKeyDate,
      })),
    },
  };
}

/**
 * Cierra la gestión: valida etapa, categoría y motivo; fija el resultado;
 * reanuda el bot si no queda otra gestión abierta; ejecuta las reglas del tipo.
 */
export function closeCase(run: Run, input: CloseCaseInput): Result<{ status: OutcomeKind; effects: RuleEffectsSummary; row: LabCase }> {
  const prepared = prepareClose(run, input, false);
  if (isError(prepared)) return prepared;
  const p = prepared.prepared;
  const { row } = p;

  const note = input.note?.trim() || null;
  let keyDate: string | null = null;
  if (p.askKeyDate) {
    if (!isDateString(input.keyDate)) return { error: `Indica la fecha: ${p.askKeyDate.label}.` };
    keyDate = input.keyDate;
  }
  if (input.scheduleOverride?.scheduleAt && !parseScheduleAt(input.scheduleOverride.scheduleAt, run.now)) {
    return { error: "La fecha de la gestión programada no es válida." };
  }

  const fromStage = row.stageId;
  Object.assign(row, {
    status: p.kind,
    stageId: p.stageId,
    categoryId: p.categoryId,
    outcomeReasonId: p.outcomeReasonId,
    closedAt: run.nowIso,
    closedFromStageId: fromStage,
    waitingSince: null,
  } satisfies Partial<LabCase>);
  if (note) row.notes.push({ at: run.nowIso, body: note, authorId: null });

  const reason = p.type?.reasons.find((r) => r.id === p.outcomeReasonId)?.name;
  run.ok(
    "case_closed",
    `La gestión se cierra como ${p.kind === "won" ? "ganada" : p.kind === "lost" ? "perdida" : "resuelta"} en la etapa «${stageName(run.catalog, p.stageId)}»${reason ? ` (motivo: ${reason})` : ""}.`,
    { caseId: row.id, data: { outcome: p.kind, stageId: p.stageId, outcomeReasonId: p.outcomeReasonId } },
  );
  emitStageChanged(run, row, fromStage, p.stageId);
  emitCaseClosed(run, row, p.stageId, p.kind);

  const plan = planRules({
    rules: p.rules,
    ctx: p.ctx,
    wonCount: p.wonCount,
    now: run.now,
    keyDate: keyDate ?? run.state.contact.keyDate,
    overrides: { scheduleAt: input.scheduleOverride?.scheduleAt, skipSchedule: input.scheduleOverride?.skip },
  });
  const effects = applyRulePlan(run, plan, row, keyDate);
  resumeAutomationIfIdle(run);
  return { ok: true, status: p.kind, effects, row };
}

// ── Mensajes de una persona ─────────────────────────────────────────────────

/**
 * Respuesta de una persona desde el CRM: sella la salida, cierra la espera,
 * registra la primera respuesta humana y pausa el bot de la conversación.
 */
export function handleHumanOutbound(run: Run, agentId: string | null) {
  const open = run.state.cases.filter((c) => c.status === "open").sort(compareLatestOpen);
  const row = (agentId ? open.find((c) => c.assigneeId === agentId) : undefined) ?? open[0];
  if (row) {
    const { patch, firstResponseSeconds } = humanOutboundPatch(
      { waiting_since: row.waitingSince, first_response_at: row.firstResponseAt },
      run.nowIso,
    );
    Object.assign(row, patchCase(patch));
    row.outboundOrder = nextOrder(run);
    run.ok(
      "info",
      firstResponseSeconds !== null
        ? `Primera respuesta humana: el cliente esperó ${formatDuration(firstResponseSeconds)}. Se sella la salida y termina la espera del cliente.`
        : "Respuesta humana: se sella la salida y termina la espera del cliente.",
      { caseId: row.id, data: { firstResponseSeconds } },
    );
  } else {
    run.warn("No hay gestión abierta: la respuesta no sella nada en ninguna gestión.");
  }
  pauseAutomation(run, "respondió una persona");
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 48) return `${hours} h`;
  return `${Math.round((hours / 24) * 10) / 10} días`;
}

// ── Cron de gestiones ───────────────────────────────────────────────────────

/**
 * Programadas con fecha cumplida: se activan (reparto, plantilla automática) o,
 * si el equipo de destino está fuera de horario, pasan a la próxima apertura.
 */
export function activateScheduledCases(run: Run): number {
  const { state, index, catalog } = run;
  const now = run.now;
  let activated = 0;
  const due = state.cases
    .filter((c) => c.status === "scheduled" && c.scheduledFor && new Date(c.scheduledFor).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());

  for (const row of due) {
    const type = row.caseTypeId ? (index.caseTypeById.get(row.caseTypeId) ?? null) : null;
    const teamId = resolveTargetTeamId(routingFor(run, type, row, row.teamId));
    const open = isOpenAt(index.hours, teamId, now);
    const plan = planActivation({
      isOpen: open,
      nextOpening: open ? null : nextOpeningFor(index.hours, teamId, now),
      now,
      scheduledFor: row.scheduledFor,
    });
    if (plan.action === "defer" && row.scheduledFor) {
      const from = row.scheduledFor;
      row.scheduledFor = plan.to.toISOString();
      run.step("case_scheduled", `La gestión «${caseTypeName(catalog, row.caseTypeId)}» programada cae fuera de horario: pasa a la próxima apertura, ${formatLima(plan.to)}.`, {
        caseId: row.id,
        level: "warning",
        data: { from, to: row.scheduledFor, reason: "off_hours" },
      });
      continue;
    }

    row.status = "open";
    row.openedAt = run.nowIso;
    activated++;
    run.ok("case_activated", `Se activa la gestión programada «${caseTypeName(catalog, row.caseTypeId)}» (hoy es su fecha).`, { caseId: row.id });

    if (!row.assigneeId) assignCase(run, row, { at: now });
    if (type?.autoTemplate) sendAutoTemplate(run, row);
  }
  return activated;
}

export type AutoTemplateOutcome =
  | { status: "none" }
  | { status: "sent"; params: string[] }
  | { status: "skipped"; reason: "not_open" | "already_sent" | "no_whatsapp_channel" | "no_phone" }
  | { status: "failed"; error: string };

/** Plantilla automática al activarse una gestión proactiva: la envía, sella y pasa a la segunda etapa abierta. */
export function sendAutoTemplate(run: Run, row: LabCase): AutoTemplateOutcome {
  const { state, catalog, index } = run;
  if (row.status !== "open") return { status: "skipped", reason: "not_open" };
  if (!row.caseTypeId) return { status: "none" };
  if (row.autoTemplateSentAt) return { status: "skipped", reason: "already_sent" };
  const type = index.caseTypeById.get(row.caseTypeId);
  const template = parseAutoTemplate(type?.autoTemplate);
  if (!type || !template) return { status: "none" };

  if (state.channel !== "whatsapp") {
    run.step(
      "auto_template",
      `«${type.name}» tiene una plantilla automática de WhatsApp, pero esta conversación simulada es de ${state.channel === "instagram" ? "Instagram" : "Facebook"}: no se envía.`,
      { caseId: row.id, level: "warning", data: { reason: "no_whatsapp_channel" } },
    );
    return { status: "skipped", reason: "no_whatsapp_channel" };
  }
  if (!phoneDigits(state.contact.phone)) {
    run.step("auto_template", `El contacto no tiene un número de WhatsApp: no se envía la plantilla «${template.template_name}».`, {
      caseId: row.id,
      level: "warning",
      data: { reason: "no_phone" },
    });
    return { status: "skipped", reason: "no_phone" };
  }

  const needs = (token: string) => template.params.some((p) => p.toLowerCase().includes(token));
  const built = buildAutoTemplateParams(template, {
    contactName: state.contact.name,
    keyDate: state.contact.keyDate,
    workspaceName: index.hours.workspaceName,
    teamName: row.teamId ? index.hours.teamNames.get(row.teamId) : null,
    agentName: row.assigneeId && needs("{asesor}") ? memberName(catalog, row.assigneeId) : null,
    customFields: needs("{campo:") ? state.contact.customFields : undefined,
  });
  if (!built.ok) {
    run.step("auto_template", `No se pudo enviar la plantilla «${template.template_name}»: ${built.error}`, {
      caseId: row.id,
      level: "warning",
      data: { error: built.error },
    });
    return { status: "failed", error: built.error };
  }

  const message = run.addMessage({
    author: "bot",
    kind: "template",
    text: demoTemplateText(template.template_name, built.params),
    template: { name: template.template_name, language: template.language, params: built.params },
    authorName: `Plantilla automática de «${type.name}»`,
  });
  row.autoTemplateSentAt = run.nowIso;
  row.lastOutboundAt = run.nowIso;
  row.outboundOrder = nextOrder(run);
  run.ok("auto_template", `Se envía la plantilla automática «${template.template_name}» al contacto.`, {
    caseId: row.id,
    messageId: message.id,
    data: { template: template.template_name, params: built.params },
  });

  // Segunda etapa abierta ("Recordatorio enviado" / "Contactado").
  const nextStage = nextAutoTemplateStageId(type.stages.filter((s) => s.kind === "open"), row.stageId);
  if (nextStage) {
    const moved = changeStage(run, row, nextStage);
    if (isError(moved)) run.warn(`No se pudo pasar la gestión a la segunda etapa: ${moved.error}`);
  }
  return { status: "sent", params: built.params };
}

/** Reintenta el reparto de las abiertas sin responsable (alguien volvió a estar disponible, abrió el horario...). */
export function retryUnassignedCases(run: Run): number {
  const { state, catalog, index } = run;
  let assigned = 0;
  for (const row of state.cases.filter((c) => c.status === "open" && !c.assigneeId)) {
    // Atajo: sin nadie disponible no hay nada que intentar.
    const anyAvailable = catalog.members.some((m) => (state.members[m.userId]?.availability ?? m.availability) === "available");
    if (!anyAvailable) continue;
    // Con el equipo (o la empresa sin equipos) cerrado no se reparte.
    if ((row.teamId || catalog.teams.length === 0) && !isOpenAt(index.hours, row.teamId, run.now)) continue;
    const outcome = assignCase(run, row, { at: run.now, silent: true });
    if (outcome.status === "assigned") assigned++;
  }
  return assigned;
}

/** Umbrales de client_no_reply de los disparadores activos. */
export function noReplyThresholds(run: Run): number[] {
  const triggers = activeTriggers(run.catalog, run.state, "client_no_reply");
  return [...new Set(triggers.map((t) => noReplyMinutes(t.config)))].sort((a, b) => a - b);
}

/** Detecta "cliente sin responder": sella el umbral alcanzado y emite el evento (uno por gestión y vuelta). */
export function detectClientNoReply(run: Run): number {
  const thresholds = noReplyThresholds(run);
  if (thresholds.length === 0) return 0;
  const min = thresholds[0];
  const max = thresholds[thresholds.length - 1];
  const olderThan = new Date(run.now.getTime() - min * 60_000);
  let emitted = 0;
  for (const row of run.state.cases) {
    const candidate = isPendingNoReply(
      {
        status: row.status,
        last_outbound_at: row.lastOutboundAt,
        // Con sellos en el mismo instante, cuenta el orden en que ocurrieron.
        last_inbound_at: outboundAfterInbound(row) ? null : row.lastInboundAt,
        no_reply_event_outbound_at: row.noReplyEventOutboundAt,
        no_reply_event_minutes: row.noReplyEventMinutes,
      },
      olderThan,
      max,
    );
    if (!candidate || !row.lastOutboundAt) continue;
    const threshold = nextNoReplyThreshold({
      thresholds,
      lastOutboundAt: row.lastOutboundAt,
      stampedOutboundAt: row.noReplyEventOutboundAt,
      stampedMinutes: row.noReplyEventMinutes,
      now: run.now,
    });
    if (threshold === null) continue;
    row.noReplyEventOutboundAt = row.lastOutboundAt;
    row.noReplyEventMinutes = threshold;
    run.step("case_event", `El cliente lleva ${threshold} min sin responder el último mensaje: se emite el evento «cliente sin responder».`, {
      caseId: row.id,
      data: { event: "client_no_reply", minutes: threshold },
    });
    run.enqueue({ type: "client_no_reply", caseId: row.id, caseTypeId: row.caseTypeId, stageId: row.stageId });
    emitted++;
  }
  return emitted;
}

/** Instante en que el próximo umbral de "cliente sin responder" se cumple para una gestión, o null. */
export function nextNoReplyDue(run: Run, row: LabCase, thresholds: readonly number[]): number | null {
  if (row.status !== "open" || !row.lastOutboundAt) return null;
  if (!outboundAfterInbound(row)) return null;
  const out = new Date(row.lastOutboundAt).getTime();
  const sameMessage = row.noReplyEventOutboundAt !== null && new Date(row.noReplyEventOutboundAt).getTime() === out;
  const done = sameMessage ? (row.noReplyEventMinutes ?? 0) : 0;
  const next = [...thresholds].sort((a, b) => a - b).find((t) => t > done);
  return next === undefined ? null : out + next * 60_000;
}

/** Disparadores de eventos que escuchan un tipo de evento (para explicar cuando ninguno coincide). */
export function selectEventTriggers(
  run: Run,
  event: { type: "case_opened" | "case_stage_changed" | "case_closed" | "client_no_reply"; caseTypeId: string | null; stageId: string | null; outcome?: OutcomeKind; contactTypeId?: string | null; chain?: readonly string[] },
  stampedMinutes: number | null,
) {
  const triggers = activeTriggers(run.catalog, run.state, event.type).map((t) => ({ ...t, flow_id: t.flowId }));
  return { all: triggers, selected: selectCaseTriggers(triggers, event, stampedMinutes) };
}

