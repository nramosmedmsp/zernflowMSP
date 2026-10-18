// Eventos de gestión para los flujos (docs/FASE-2-TECNICO.md 3.6). El motor
// no espera a los flujos: así no frena la acción del usuario ni el cron.

import { after } from "next/server";
import { runCaseEventFlows, type CaseFlowEvent } from "@/lib/flow-engine/case-triggers";
import type { OutcomeKind } from "@/lib/types/database";
import type { Db } from "./io";

function run(db: Db, event: CaseFlowEvent): Promise<void> {
  try {
    return runCaseEventFlows(db, event).catch((err) => {
      console.error(`[cases] flujos del evento ${event.type}`, err);
    });
  } catch (err) {
    console.error(`[cases] flujos del evento ${event.type}`, err);
    return Promise.resolve();
  }
}

/**
 * Emite un evento sin esperar a los flujos. Dentro de una solicitud de Next
 * se programa con `after` (corre después de responder y la plataforma lo
 * espera); fuera de ella (pruebas, scripts) se lanza en el momento. Nunca
 * lanza errores.
 */
export function emitCaseEvent(db: Db, event: CaseFlowEvent): void {
  try {
    after(() => run(db, event));
  } catch {
    void run(db, event);
  }
}

interface CaseRef {
  id: string;
  workspace_id: string;
  contact_id: string;
  case_type_id: string | null;
}

/** case_stage_changed si la etapa cambió. */
export function emitStageChanged(db: Db, row: CaseRef, fromStageId: string | null, toStageId: string | null): void {
  if (fromStageId === toStageId) return;
  emitCaseEvent(db, {
    type: "case_stage_changed",
    workspaceId: row.workspace_id,
    caseId: row.id,
    contactId: row.contact_id,
    caseTypeId: row.case_type_id,
    stageId: toStageId,
  });
}

/** case_closed con su resultado. */
export function emitCaseClosed(db: Db, row: CaseRef, stageId: string | null, outcome: OutcomeKind): void {
  emitCaseEvent(db, {
    type: "case_closed",
    workspaceId: row.workspace_id,
    caseId: row.id,
    contactId: row.contact_id,
    caseTypeId: row.case_type_id,
    stageId,
    outcome,
  });
}
