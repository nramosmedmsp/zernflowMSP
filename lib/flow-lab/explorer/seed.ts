// Preparación del estado de partida: la gestión abierta que necesitan los
// flujos que arrancan por un evento de gestión (cierre, cambio de etapa, cliente
// sin responder) o las condiciones sobre la gestión. Muta el estado que recibe
// (siempre es una copia del explorador).

import { indexCatalog } from "../catalog";
import { latestOpenCase, newCaseTemplate, nextId } from "../state";
import type { LabCase, LabCaseType, LabCatalog, LabMessage, LabState } from "../types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function ago(state: LabState, ms: number): string {
  return new Date(new Date(state.clock).getTime() - ms).toISOString();
}

export function firstOpenStageId(type: LabCaseType | undefined, exceptStageId?: string): string | null {
  const open = (type?.stages ?? []).filter((s) => s.kind === "open").sort((a, b) => a.position - b.position);
  return (open.find((s) => s.id !== exceptStageId) ?? open[0])?.id ?? null;
}

export interface SeedCaseOptions {
  caseTypeId?: string | null;
  stageId?: string | null;
  /** Ventana de 24 h de WhatsApp: abierta (el cliente escribió hace minutos) o cerrada (hace 3 días). */
  windowOpen?: boolean;
  /** Minutos desde el último mensaje del bot hasta ahora (para «cliente sin responder»). */
  botSilentMinutes?: number;
  assigneeId?: string | null;
}

function addMessage(state: LabState, author: LabMessage["author"], text: string, at: string, extra: Partial<LabMessage> = {}) {
  state.messages.push({ id: nextId(state, "message"), at, author, kind: "text", text, ...extra });
}

/** Abre una gestión de prueba (con un mensaje del cliente y uno de la empresa) y marca al contacto como existente. */
export function seedOpenCase(catalog: LabCatalog, state: LabState, options: SeedCaseOptions = {}): LabCase {
  const index = indexCatalog(catalog);
  const type = options.caseTypeId ? index.caseTypeById.get(options.caseTypeId) : undefined;
  const stageId = options.stageId ?? firstOpenStageId(type);
  const windowOpen = options.windowOpen ?? true;
  const silent = options.botSilentMinutes ?? 20;
  const inboundAt = windowOpen ? ago(state, Math.max(silent + 10, 30) * MINUTE) : ago(state, 3 * DAY);
  const outboundAt = windowOpen ? ago(state, silent * MINUTE) : ago(state, 3 * DAY - 5 * MINUTE);
  const assigneeId = options.assigneeId === undefined ? (catalog.members[0]?.userId ?? null) : options.assigneeId;

  const row = newCaseTemplate(nextId(state, "case"), ago(state, 2 * 60 * MINUTE));
  Object.assign(row, {
    caseTypeId: type?.id ?? null,
    stageId,
    status: "open",
    origin: "inbound",
    teamId: state.contact.teamId,
    assigneeId,
    assignedAt: assigneeId ? ago(state, 100 * MINUTE) : null,
    openedAt: ago(state, 2 * 60 * MINUTE),
    lastInboundAt: inboundAt,
    lastOutboundAt: outboundAt,
    firstResponseAt: outboundAt,
  } satisfies Partial<LabCase>);
  state.cases.push(row);
  addMessage(state, "client", "Hola", inboundAt);
  addMessage(state, "agent", "Hola, ¿en qué te puedo ayudar?", outboundAt, { authorName: "Asesor" });
  state.contact.existed = true;
  return row;
}

/** La gestión abierta del contacto; si no tiene, abre una de prueba. */
export function ensureOpenCase(catalog: LabCatalog, state: LabState, options: SeedCaseOptions = {}): LabCase {
  return latestOpenCase(state) ?? seedOpenCase(catalog, state, options);
}

/** Cierra la ventana de 24 h: el último mensaje del cliente fue hace 3 días. */
export function closeWindow(state: LabState): void {
  const at = ago(state, 3 * DAY);
  for (const c of state.cases) if (c.lastInboundAt) c.lastInboundAt = at;
  for (const m of state.messages) if (m.author === "client") m.at = at;
}
