// Detección de "cliente sin responder" para los flujos (docs/FASE-2-TECNICO.md
// 3.6). La corre el cron.
//
// Criterio: gestión abierta cuyo último mensaje saliente (humano o bot) es
// posterior al último entrante. No se mira waiting_since (que el cliente espere
// respuesta humana no impide avisar de que no contestó el último mensaje). Los umbrales son los `config.minutes` de los
// disparadores client_no_reply activos de flujos publicados del espacio.
// Por cada mensaje saliente se emite un evento por umbral, del menor al mayor
// (uno por vuelta del cron), y antes de emitirlo se sella en la gestión
// no_reply_event_outbound_at (= last_outbound_at) y no_reply_event_minutes
// (= umbral). Un mensaje saliente nuevo reinicia la cuenta; nunca se repite
// un evento para el mismo mensaje y umbral.

import type { Database } from "@/lib/types/database";
import { emitCaseEvent } from "./events";
import { nextNoReplyThreshold, noReplyMinutes } from "./no-reply-rules";
import type { Db } from "./io";

// La parte pura vive en no-reply-rules.ts; se re-exporta para no cambiar las importaciones.
export { nextNoReplyThreshold, noReplyMinutes };

type PendingRow = Database["public"]["Functions"]["cases_pending_no_reply"]["Returns"][number];

const BATCH = 100;
const MAX_PER_RUN = 500;

function timeLeft(deadline: number): boolean {
  return Date.now() < deadline;
}

/** Umbrales por espacio de los disparadores client_no_reply activos y publicados. */
async function thresholdsByWorkspace(db: Db): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const { data: triggers, error } = await db
    .from("triggers")
    .select("flow_id, config")
    .eq("type", "client_no_reply")
    .eq("is_active", true);
  if (error) {
    console.error("[cases cron] no reply triggers", error.message);
    return result;
  }
  if (!triggers || triggers.length === 0) return result;
  const { data: flows } = await db
    .from("flows")
    .select("id, workspace_id, status")
    .in("id", [...new Set(triggers.map((t) => t.flow_id))])
    .eq("status", "published");
  const wsByFlow = new Map((flows ?? []).map((f) => [f.id, f.workspace_id]));
  for (const t of triggers) {
    const ws = wsByFlow.get(t.flow_id);
    if (!ws) continue;
    const list = result.get(ws) ?? [];
    const minutes = noReplyMinutes(t.config);
    if (!list.includes(minutes)) list.push(minutes);
    result.set(ws, list.sort((a, b) => a - b));
  }
  return result;
}

async function pendingPage(db: Db, args: Database["public"]["Functions"]["cases_pending_no_reply"]["Args"]) {
  return db.rpc("cases_pending_no_reply", args);
}

export async function detectClientNoReply(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ emitted: number; stoppedEarly: boolean }> {
  const now = opts.now ?? new Date();
  let emitted = 0;
  let processed = 0;
  const byWorkspace = await thresholdsByWorkspace(db);

  for (const [workspaceId, thresholds] of byWorkspace) {
    const min = thresholds[0];
    const max = thresholds[thresholds.length - 1];
    let afterId: string | null = null;
    while (processed < MAX_PER_RUN) {
      if (!timeLeft(opts.deadline)) return { emitted, stoppedEarly: true };
      const page: { data: PendingRow[] | null; error: { message: string } | null } = await pendingPage(db, {
        p_workspace_id: workspaceId,
        p_older_than: new Date(now.getTime() - min * 60_000).toISOString(),
        p_max_minutes: max,
        p_after_id: afterId,
        p_limit: BATCH,
      });
      const { data, error } = page;
      if (error) {
        console.error("[cases cron] no reply", error.message);
        break;
      }
      const rows: PendingRow[] = data ?? [];
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1].id;

      for (const row of rows) {
        processed++;
        const threshold = nextNoReplyThreshold({
          thresholds,
          lastOutboundAt: row.last_outbound_at,
          stampedOutboundAt: row.no_reply_event_outbound_at,
          stampedMinutes: row.no_reply_event_minutes,
          now,
        });
        if (threshold === null) continue;
        // Sello condicional: solo emite quien lo puso (dos crons solapados no duplican).
        let claim = db
          .from("cases")
          .update({ no_reply_event_outbound_at: row.last_outbound_at, no_reply_event_minutes: threshold })
          .eq("id", row.id)
          .eq("status", "open")
          .eq("last_outbound_at", row.last_outbound_at);
        claim = row.no_reply_event_minutes === null
          ? claim.is("no_reply_event_minutes", null)
          : claim.eq("no_reply_event_minutes", row.no_reply_event_minutes);
        claim = row.no_reply_event_outbound_at === null
          ? claim.is("no_reply_event_outbound_at", null)
          : claim.eq("no_reply_event_outbound_at", row.no_reply_event_outbound_at);
        const { data: claimed, error: claimError } = await claim.select("id");
        if (claimError) {
          console.error("[cases cron] no reply claim", claimError.message);
          continue;
        }
        if (!claimed || claimed.length === 0) continue;
        emitCaseEvent(db, {
          type: "client_no_reply",
          workspaceId,
          caseId: row.id,
          contactId: row.contact_id,
          caseTypeId: row.case_type_id,
          stageId: row.stage_id,
        });
        emitted++;
      }
      if (rows.length < BATCH) break;
    }
  }
  return { emitted, stoppedEarly: !timeLeft(opts.deadline) };
}
