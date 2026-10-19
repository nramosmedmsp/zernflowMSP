// Frases en español de los pasos y las expectativas de un escenario.

import { LAB_CHANNEL_LABELS } from "../types";
import type { ExpectedCaseStatus, ScenarioDefinition, ScenarioExpectation, ScenarioProfile, ScenarioStep } from "./types";

export const STATUS_LABELS: Record<ExpectedCaseStatus, string> = {
  open: "abierta",
  won: "ganada",
  lost: "perdida",
  resolved: "resuelta",
  scheduled: "programada",
};

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = m / 60;
    return Number.isInteger(h) ? `${h} h` : `${Math.floor(h)} h ${m % 60} min`;
  }
  const d = m / (60 * 24);
  return Number.isInteger(d) ? `${d} ${d === 1 ? "día" : "días"}` : `${Math.floor(d)} d ${Math.round((m % (60 * 24)) / 60)} h`;
}

export function describeStep(step: ScenarioStep): string {
  switch (step.type) {
    case "client_text":
      return `El cliente escribe: «${step.text}»`;
    case "client_button":
      return `El cliente pulsa «${step.title}»`;
    case "advance":
      return `Pasan ${formatDuration(step.minutes)}`;
    case "agent_reply":
      return `${step.agent ? `${step.agent} (asesor)` : "El asesor"} responde: «${step.text}»`;
    case "change_stage":
      return `El asesor mueve la gestión a «${step.stage}»`;
    case "classify":
      return `El asesor clasifica la gestión como «${step.caseType}»`;
    case "set_category":
      return step.category ? `El asesor pone la categoría «${step.category}»` : "El asesor quita la categoría";
    case "assign":
      return step.member ? `El asesor asigna la gestión a ${step.member}` : "El asesor devuelve la gestión a la cola";
    case "close": {
      const how = step.stage ? `en «${step.stage}»` : step.outcome === "lost" ? "como perdida" : step.outcome === "resolved" ? "como resuelta" : "como ganada";
      return `El asesor cierra la gestión ${how}${step.reason ? ` (motivo «${step.reason}»)` : ""}`;
    }
    case "pause_bot":
      return step.paused ? "El asesor pausa el bot" : "El asesor reanuda el bot";
  }
}

export function describeProfile(profile: ScenarioProfile): string {
  if (profile.kind === "sample") return `Perfil «${profile.name}»`;
  const parts = [`Contacto «${profile.name}»`];
  if (profile.contactType) parts.push(`tipo ${profile.contactType}`);
  if (profile.tags.length) parts.push(`etiquetas ${profile.tags.join(", ")}`);
  parts.push(profile.existed ? "ya existe" : "contacto nuevo");
  if (profile.caseType) parts.push(`con una gestión de ${profile.caseType}${profile.stage ? ` en «${profile.stage}»` : ""}`);
  return parts.join(" · ");
}

export function describeSetup(def: ScenarioDefinition): string {
  const flows = def.flows === "published" ? "todos los flujos publicados" : def.flows.length ? `flujos: ${def.flows.join(", ")}` : "ningún flujo";
  return `${describeProfile(def.profile)} · ${LAB_CHANNEL_LABELS[def.channel]} · ${flows}`;
}

/** Frase de la expectativa, sin el momento en que se comprueba (ver describeWhen). */
export function describeExpectation(e: ScenarioExpectation): string {
  const of = "of" in e && e.of ? ` (gestión de ${e.of})` : "";
  switch (e.kind) {
    case "flow_activated":
      return `Se activó el flujo «${e.flow}»${e.scope === "step" ? " en ese paso" : ""}`;
    case "bot_message_contains":
      return `El bot envió un mensaje que contiene «${e.text}»${e.scope === "step" ? " en ese paso" : ""}`;
    case "template_sent":
      return `Se envió una plantilla de WhatsApp${e.name ? ` «${e.name}»` : ""}${e.scope === "step" ? " en ese paso" : ""}`;
    case "case_type":
      return `La gestión es de tipo «${e.caseType}»`;
    case "case_stage":
      return `La gestión${of} está en la etapa «${e.stage}»`;
    case "case_status":
      return `La gestión${of} está ${STATUS_LABELS[e.status]}`;
    case "assigned":
      return e.assigned ? `La gestión${of} tiene responsable${e.member ? `: ${e.member}` : ""}` : `La gestión${of} no tiene responsable`;
    case "case_team":
      return `La gestión${of} es del equipo «${e.team}»`;
    case "tag":
      return e.present ? `El contacto tiene la etiqueta «${e.tag}»` : `El contacto no tiene la etiqueta «${e.tag}»`;
    case "contact_type":
      return `El contacto es de tipo «${e.contactType}»`;
    case "custom_field":
      return `El campo «${e.field}» del contacto vale «${e.value}»`;
    case "subscribed":
      return e.subscribed ? "El contacto está suscrito" : "El contacto se dio de baja";
    case "scheduled_case":
      return `Hay una gestión de «${e.caseType}» programada para dentro de ${e.inDays} ${e.inDays === 1 ? "día" : "días"}`;
    case "bot_paused":
      return e.paused ? "El bot está en pausa" : "El bot está activo";
    case "nothing_sent":
      return "El bot no envió ningún mensaje";
  }
}

/** "Al final" o "Después del paso 3: …". */
export function describeWhen(e: Pick<ScenarioExpectation, "after">, steps: readonly ScenarioStep[]): string {
  if (e.after == null) return "Al final";
  const step = steps[e.after - 1];
  return step ? `Después del paso ${e.after}` : `Después del paso ${e.after} (no existe)`;
}
