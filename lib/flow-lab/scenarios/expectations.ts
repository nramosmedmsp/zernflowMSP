// Comprobación de las expectativas de un escenario contra el estado (y la
// traza del paso) en el que se evalúan. Cada una devuelve lo esperado y lo
// obtenido en español, para mostrarlos tal cual.

import { addDays, limaDateOf } from "@/lib/cases/dates";
import { caseTypeName, contactTypeName, memberName, stageName, teamName } from "../catalog";
import { currentCase } from "../state";
import type { LabCase, LabCatalog, LabMessage, LabState, LabTrace } from "../types";
import { describeExpectation, STATUS_LABELS } from "./describe";
import { findByName, normalizeName, sameName } from "./names";
import type { ExpectationResult, ScenarioExpectation } from "./types";

interface Outcome {
  ok: boolean;
  expected: string;
  actual: string;
}

export interface EvalContext {
  catalog: LabCatalog;
  /** Estado en el momento en que se comprueba. */
  state: LabState;
  /** Traza del paso en que se comprueba (la del último paso si es "al final"). */
  trace: LabTrace | undefined;
}

const q = (text: string) => `«${text}»`;

function short(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function botMessages(ctx: EvalContext, scope: "conversation" | "step" | undefined): LabMessage[] {
  const list = scope === "step" ? (ctx.trace?.messages ?? []) : ctx.state.messages;
  return list.filter((m) => m.author === "bot");
}

function listMessages(messages: LabMessage[]): string {
  if (messages.length === 0) return "el bot no envió ningún mensaje";
  const shown = messages.slice(-3).map((m) => q(short(m.text, 70)));
  return `mensajes del bot: ${messages.length > 3 ? "… " : ""}${shown.join(", ")}`;
}

/** Gestión a mirar: la última del tipo `of`, o la actual. */
function pickCase(ctx: EvalContext, of: string | undefined): { row: LabCase | null; error?: string } {
  if (!of) return { row: currentCase(ctx.state) };
  const type = findByName(ctx.catalog.caseTypes, of);
  if (!type) return { row: null, error: `El espacio no tiene un tipo de gestión ${q(of)}.` };
  const rows = ctx.state.cases.filter((c) => c.caseTypeId === type.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { row: rows[0] ?? null };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function evaluate(e: ScenarioExpectation, ctx: EvalContext): Outcome {
  const { catalog, state } = ctx;
  switch (e.kind) {
    case "flow_activated": {
      const flow = findByName(catalog.flows, e.flow);
      const expected = `el flujo ${q(e.flow)} se activa${e.scope === "step" ? " en ese paso" : ""}`;
      if (!flow) return { ok: false, expected, actual: `el espacio no tiene un flujo ${q(e.flow)}` };
      const startedIds =
        e.scope === "step"
          ? new Set((ctx.trace?.steps ?? []).filter((s) => s.kind === "flow_started" && s.flowId).map((s) => s.flowId as string))
          : new Set(state.sessions.map((s) => s.flowId));
      const names = [...startedIds].map((id) => catalog.flows.find((f) => f.id === id)?.name ?? id);
      return {
        ok: startedIds.has(flow.id),
        expected,
        actual: names.length > 0 ? `flujos activados${e.scope === "step" ? " en ese paso" : ""}: ${names.map(q).join(", ")}` : "no se activó ningún flujo",
      };
    }
    case "bot_message_contains": {
      const messages = botMessages(ctx, e.scope);
      const wanted = normalizeName(e.text);
      return {
        ok: messages.some((m) => normalizeName(m.text).includes(wanted)),
        expected: `un mensaje del bot con ${q(e.text)}`,
        actual: listMessages(messages),
      };
    }
    case "template_sent": {
      const templates = botMessages(ctx, e.scope).filter((m) => m.kind === "template");
      const matching = e.name ? templates.filter((m) => sameName(m.template?.name, e.name)) : templates;
      return {
        ok: matching.length > 0,
        expected: `una plantilla de WhatsApp${e.name ? ` ${q(e.name)}` : ""}`,
        actual: templates.length > 0 ? `plantillas enviadas: ${templates.map((m) => q(m.template?.name ?? "sin nombre")).join(", ")}` : "no se envió ninguna plantilla",
      };
    }
    case "case_type": {
      const row = currentCase(state);
      const actual = row ? caseTypeName(catalog, row.caseTypeId) : "no hay ninguna gestión";
      return { ok: !!row && sameName(actual, e.caseType), expected: q(e.caseType), actual: row ? q(actual) : actual };
    }
    case "case_stage": {
      const { row, error } = pickCase(ctx, e.of);
      const actual = error ?? (row ? stageName(catalog, row.stageId) : e.of ? `no hay ninguna gestión de ${q(e.of)}` : "no hay ninguna gestión");
      return { ok: !!row && !error && sameName(stageName(catalog, row.stageId), e.stage), expected: q(e.stage), actual: row && !error ? q(actual) : actual };
    }
    case "case_status": {
      const { row, error } = pickCase(ctx, e.of);
      const label = (s: string) => (STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s);
      return {
        ok: !!row && !error && row.status === e.status,
        expected: label(e.status),
        actual: error ?? (row ? label(row.status) : e.of ? `no hay ninguna gestión de ${q(e.of)}` : "no hay ninguna gestión"),
      };
    }
    case "assigned": {
      const { row, error } = pickCase(ctx, e.of);
      const expected = e.assigned ? (e.member ? `asignada a ${e.member}` : "con responsable") : "sin responsable";
      if (error || !row) return { ok: false, expected, actual: error ?? "no hay ninguna gestión" };
      const actual = row.assigneeId ? `asignada a ${memberName(catalog, row.assigneeId)}` : "sin responsable";
      const ok = e.assigned ? !!row.assigneeId && (!e.member || sameName(memberName(catalog, row.assigneeId), e.member)) : !row.assigneeId;
      return { ok, expected, actual };
    }
    case "case_team": {
      const { row, error } = pickCase(ctx, e.of);
      if (error || !row) return { ok: false, expected: q(e.team), actual: error ?? "no hay ninguna gestión" };
      const actual = teamName(catalog, row.teamId);
      return { ok: !!row.teamId && sameName(actual, e.team), expected: q(e.team), actual: row.teamId ? q(actual) : actual };
    }
    case "tag": {
      const has = state.contact.tags.some((t) => sameName(t, e.tag));
      return {
        ok: has === e.present,
        expected: e.present ? `con la etiqueta ${q(e.tag)}` : `sin la etiqueta ${q(e.tag)}`,
        actual: state.contact.tags.length > 0 ? `etiquetas: ${state.contact.tags.map(q).join(", ")}` : "sin etiquetas",
      };
    }
    case "contact_type": {
      const actual = contactTypeName(catalog, state.contact.contactTypeId);
      return { ok: !!state.contact.contactTypeId && sameName(actual, e.contactType), expected: q(e.contactType), actual: state.contact.contactTypeId ? q(actual) : actual };
    }
    case "custom_field": {
      const def = catalog.customFields.find((f) => sameName(f.slug, e.field) || sameName(f.name, e.field));
      const slug = def?.slug ?? e.field;
      const value = state.contact.customFields[slug];
      return {
        ok: value !== undefined && normalizeName(value) === normalizeName(e.value),
        expected: q(e.value),
        actual: value !== undefined ? q(value) : def ? "el campo está vacío" : `el campo ${q(e.field)} no tiene valor`,
      };
    }
    case "subscribed":
      return {
        ok: state.contact.subscribed === e.subscribed,
        expected: e.subscribed ? "suscrito" : "dado de baja",
        actual: state.contact.subscribed ? "suscrito" : "dado de baja",
      };
    case "scheduled_case": {
      const type = findByName(catalog.caseTypes, e.caseType);
      const expected = `una gestión de ${q(e.caseType)} programada para dentro de ${e.inDays} ${e.inDays === 1 ? "día" : "días"}`;
      if (!type) return { ok: false, expected, actual: `el espacio no tiene un tipo de gestión ${q(e.caseType)}` };
      const today = limaDateOf(new Date(state.clock));
      const target = addDays(today, e.inDays);
      const scheduled = state.cases.filter((c) => c.caseTypeId === type.id && c.status === "scheduled" && c.scheduledFor);
      const ok = scheduled.some((c) => limaDateOf(new Date(c.scheduledFor as string)) === target);
      const actual =
        scheduled.length > 0
          ? scheduled
              .map((c) => {
                const date = limaDateOf(new Date(c.scheduledFor as string));
                const n = daysBetween(today, date);
                return `programada para dentro de ${n} ${n === 1 ? "día" : "días"} (${date.split("-").reverse().join("/")})`;
              })
              .join("; ")
          : `no hay ninguna gestión de ${q(e.caseType)} programada`;
      return { ok, expected, actual };
    }
    case "bot_paused":
      return {
        ok: state.automationPaused === e.paused,
        expected: e.paused ? "bot en pausa" : "bot activo",
        actual: state.automationPaused ? "bot en pausa" : "bot activo",
      };
    case "nothing_sent": {
      const messages = (ctx.trace?.messages ?? []).filter((m) => m.author === "bot");
      return { ok: messages.length === 0, expected: "ningún mensaje del bot", actual: listMessages(messages) };
    }
  }
}

export function evaluateExpectation(e: ScenarioExpectation, ctx: EvalContext): ExpectationResult {
  let outcome: Outcome;
  try {
    outcome = evaluate(e, ctx);
  } catch (err) {
    outcome = { ok: false, expected: describeExpectation(e), actual: `no se pudo comprobar: ${err instanceof Error ? err.message : "error desconocido"}` };
  }
  return { id: e.id, description: describeExpectation(e), after: e.after ?? null, ...outcome };
}
