// Reanudación automática del bot (decisión del dueño sobre M-12): si el bot
// está pausado porque una persona escribió y el contacto no tiene ninguna
// gestión abierta ni programada, el bot vuelve solo 24 h después del último
// mensaje humano de esa conversación. Lo corre el cron; es idempotente (solo
// toca conversaciones aún pausadas) y no necesita migración: la hora sale de
// messages.created_at con sent_by_user_id (mensajes enviados por una persona).
// Una pausa manual sin ningún mensaje humano no se toca.

import { logActivity, type Db } from "./io";

export const BOT_AUTO_RESUME_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;
const MAX_PER_RUN = 500;

export async function resumeIdlePausedBots(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ resumed: number; stoppedEarly: boolean }> {
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - BOT_AUTO_RESUME_MS;
  let resumed = 0;
  let stoppedEarly = false;

  // B-21: se pagina por cursor (id mayor que el último visto), no por posición:
  // las conversaciones que se reanudan salen del filtro y la posición saltaría.
  let after: string | null = null;
  for (let seen = 0; seen < MAX_PER_RUN; seen += PAGE) {
    if (Date.now() >= opts.deadline) {
      stoppedEarly = true;
      break;
    }
    let query = db
      .from("conversations")
      .select("id, workspace_id, contact_id")
      .eq("is_automation_paused", true)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (after) query = query.gt("id", after);
    const { data: page, error } = await query;
    if (error) {
      console.error("[cases cron] bot resume list", error.message);
      break;
    }
    if (!page || page.length === 0) break;
    after = page[page.length - 1].id;

    for (const conv of page) {
      const { count } = await db
        .from("cases")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", conv.contact_id)
        .in("status", ["open", "scheduled"]);
      if ((count ?? 0) > 0) continue;

      const { data: last } = await db
        .from("messages")
        .select("created_at")
        .eq("conversation_id", conv.id)
        .eq("direction", "outbound")
        .not("sent_by_user_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const lastAt = last?.[0]?.created_at;
      if (!lastAt || new Date(lastAt).getTime() > cutoff) continue;

      const { data: updated, error: updError } = await db
        .from("conversations")
        .update({ is_automation_paused: false })
        .eq("id", conv.id)
        .eq("is_automation_paused", true)
        .select("id");
      if (updError) {
        console.error("[cases cron] bot resume", updError.message);
        continue;
      }
      if (!updated || updated.length === 0) continue;
      resumed++;
      await logActivity(db, {
        workspace_id: conv.workspace_id,
        type: "automation_resumed",
        contact_id: conv.contact_id,
        conversation_id: conv.id,
        from_value: "paused",
        to_value: "active",
        meta: { source: "cron_24h", last_human_message_at: lastAt },
      });
    }
    if (page.length < PAGE) break;
  }
  return { resumed, stoppedEarly };
}
