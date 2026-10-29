// Detector de reclamos (control de reclamos): marca la conversación cuando el
// cliente escribe algo que parece un reclamo y no hay una gestión protegida
// abierta; permite abrir la Postventa o descartar el aviso; y avisa a los
// supervisores si nadie lo atiende. La frase la detecta lib/complaint-detect.ts.

import { detectComplaint } from "@/lib/complaint-detect";
import { classifyCase } from "./changes";
import {
  GENERIC_ERROR,
  clearComplaintFlag,
  contactLink,
  caseLink,
  contactName,
  loadContact,
  logActivity,
  notify,
  supervisorsOrAdmins,
  type CaseRow,
  type Db,
  type EngineResult,
  type NotificationInput,
} from "./io";
import { openCase } from "./open";
import {
  COMPLAINT_ALERT_MINUTES,
  COMPLAINT_DISMISS_DAYS,
  complaintStillPending,
  type ProtectedCaseSummary,
} from "./protection";

const BATCH = 50;
const DAY_MS = 86_400_000;

/** Tipos de gestión protegidos y activos del espacio, en su orden. */
export async function protectedTypes(db: Db, workspaceId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await db
    .from("case_types")
    .select("id, name, position")
    .eq("workspace_id", workspaceId)
    .eq("protected", true)
    .is("archived_at", null)
    .order("position", { ascending: true });
  return (data ?? []).map((t) => ({ id: t.id, name: t.name }));
}

async function protectedCasesOf(db: Db, contactId: string, typeIds: string[]): Promise<ProtectedCaseSummary[]> {
  if (typeIds.length === 0) return [];
  const { data } = await db
    .from("cases")
    .select("status, created_at, closed_at")
    .eq("contact_id", contactId)
    .in("case_type_id", typeIds);
  return (data ?? []).map((c) => ({ status: c.status, createdAt: c.created_at, closedAt: c.closed_at }));
}

export type FlagOutcome =
  | "no_match"
  | "disabled"
  | "already_flagged"
  | "dismissed_recently"
  | "has_protected_case"
  | "flagged";

/**
 * Mensaje entrante: si parece un reclamo, el contacto no tiene una gestión
 * protegida abierta y la conversación no está marcada (o se descartó hace más
 * de 7 días), la marca para que el equipo la clasifique. Las consultas solo
 * corren cuando el texto coincide; sin tipos protegidos no hace nada.
 */
export async function flagComplaint(
  db: Db,
  params: {
    workspaceId: string;
    contactId: string;
    conversationId: string;
    text: string | null | undefined;
    at?: string;
  },
): Promise<FlagOutcome> {
  const match = detectComplaint(params.text);
  if (!match) return "no_match";
  const at = params.at ?? new Date().toISOString();

  const { data: conversation } = await db
    .from("conversations")
    .select("id, complaint_flagged_at, complaint_dismissed_at")
    .eq("id", params.conversationId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (!conversation) return "no_match";
  if (conversation.complaint_flagged_at) {
    // Una marca vieja no puede tapar un reclamo nuevo: si el reclamo anterior
    // ya se atendió (hubo una gestión protegida después de la marca), se
    // descarta y se sigue con el mensaje de ahora.
    const staleTypes = await protectedTypes(db, params.workspaceId);
    const staleCases = await protectedCasesOf(db, params.contactId, staleTypes.map((t) => t.id));
    if (complaintStillPending(conversation.complaint_flagged_at, staleCases)) return "already_flagged";
    const { data: freed } = await db
      .from("conversations")
      .update({ complaint_flagged_at: null, complaint_excerpt: null })
      .eq("id", conversation.id)
      .eq("complaint_flagged_at", conversation.complaint_flagged_at)
      .select("id");
    if (!freed || freed.length === 0) return "already_flagged";
  }
  if (conversation.complaint_dismissed_at) {
    const since = new Date(at).getTime() - new Date(conversation.complaint_dismissed_at).getTime();
    if (since < COMPLAINT_DISMISS_DAYS * DAY_MS) return "dismissed_recently";
  }

  const types = await protectedTypes(db, params.workspaceId);
  if (types.length === 0) return "disabled";
  const { data: open } = await db
    .from("cases")
    .select("id")
    .eq("contact_id", params.contactId)
    .eq("status", "open")
    .in("case_type_id", types.map((t) => t.id))
    .limit(1);
  if (open && open.length > 0) return "has_protected_case";

  const { data: marked } = await db
    .from("conversations")
    .update({
      complaint_flagged_at: at,
      complaint_excerpt: match.excerpt.slice(0, 120),
      complaint_alerted_at: null,
    })
    .eq("id", conversation.id)
    .is("complaint_flagged_at", null)
    .select("id");
  return marked && marked.length > 0 ? "flagged" : "already_flagged";
}

/** "No es un reclamo": quita la marca y no vuelve a avisar por 7 días. */
export async function dismissComplaint(
  db: Db,
  params: { workspaceId: string; conversationId: string; actorId: string },
  now: Date = new Date(),
): Promise<EngineResult> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id, contact_id, complaint_flagged_at, complaint_excerpt")
    .eq("id", params.conversationId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (!conversation) return { error: "Conversación no encontrada." };
  if (!conversation.complaint_flagged_at) return { ok: true };

  const { error } = await db
    .from("conversations")
    .update({ complaint_flagged_at: null, complaint_excerpt: null, complaint_dismissed_at: now.toISOString() })
    .eq("id", conversation.id);
  if (error) return { error: GENERIC_ERROR };

  await logActivity(db, {
    workspace_id: params.workspaceId,
    type: "complaint_dismissed",
    contact_id: conversation.contact_id,
    conversation_id: conversation.id,
    actor_id: params.actorId,
    meta: { excerpt: conversation.complaint_excerpt },
  });
  return { ok: true };
}

/**
 * "Abrir Postventa": si hay una gestión abierta sin clasificar la clasifica
 * como el primer tipo protegido; si no, abre una gestión nueva de ese tipo
 * para el contacto. Después quita la marca. `canClassify` dice si quien actúa
 * puede editar esa gestión.
 *
 * La marca se reclama antes de abrir (un solo clic gana): dos personas que
 * pulsan a la vez no abren dos Postventas. La gestión nueva queda asignada a
 * quien pulsa solo si es del equipo de la Postventa; si no, se reparte sola.
 */
export async function openComplaintCase(
  db: Db,
  params: {
    workspaceId: string;
    conversationId: string;
    actorId: string;
    canClassify: (row: CaseRow) => boolean;
  },
  now: Date = new Date(),
): Promise<EngineResult<{ caseId: string; classified: boolean }>> {
  const { data: conversation } = await db
    .from("conversations")
    .select("id, contact_id, complaint_flagged_at, complaint_excerpt")
    .eq("id", params.conversationId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (!conversation) return { error: "Conversación no encontrada." };

  const types = await protectedTypes(db, params.workspaceId);
  if (types.length === 0) return { error: "No hay un tipo de gestión protegido para los reclamos." };
  const target = types[0];

  const findOpenProtected = async () => {
    const { data } = await db
      .from("cases")
      .select("id")
      .eq("contact_id", conversation.contact_id)
      .eq("status", "open")
      .in("case_type_id", types.map((t) => t.id))
      .limit(1);
    return data?.[0] ?? null;
  };

  // Ya hay una gestión protegida abierta: solo se quita el aviso.
  const existing = await findOpenProtected();
  if (existing) {
    await clearComplaintFlag(db, params.workspaceId, conversation.contact_id);
    return { ok: true, caseId: existing.id, classified: false };
  }

  // Reclama el aviso: solo uno de los clics simultáneos sigue adelante.
  const flaggedAt = conversation.complaint_flagged_at;
  if (flaggedAt) {
    const { data: won } = await db
      .from("conversations")
      .update({ complaint_flagged_at: null, complaint_excerpt: null })
      .eq("id", conversation.id)
      .eq("complaint_flagged_at", flaggedAt)
      .select("id");
    if (!won || won.length === 0) {
      const other = await findOpenProtected();
      if (other) return { ok: true, caseId: other.id, classified: false };
      return { error: "Otra persona ya está atendiendo este aviso. Actualiza la pantalla." };
    }
  }
  const restoreFlag = async () => {
    if (!flaggedAt) return;
    await db
      .from("conversations")
      .update({ complaint_flagged_at: flaggedAt, complaint_excerpt: conversation.complaint_excerpt })
      .eq("id", conversation.id)
      .is("complaint_flagged_at", null);
  };
  const clear = () => clearComplaintFlag(db, params.workspaceId, conversation.contact_id);

  const { data: unclassified } = await db
    .from("cases")
    .select("*")
    .eq("contact_id", conversation.contact_id)
    .eq("status", "open")
    .is("case_type_id", null)
    .order("opened_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const candidate = unclassified?.[0] ?? null;

  if (candidate && params.canClassify(candidate)) {
    const result = await classifyCase(
      db,
      {
        caseId: candidate.id,
        caseTypeId: target.id,
        actorId: params.actorId,
        actorIsSupervisor: true, // la gestión no tiene tipo: no hay bloqueo que aplicar
      },
      now,
    );
    if ("error" in result) {
      await restoreFlag();
      return result;
    }
    await clear();
    return { ok: true, caseId: candidate.id, classified: true };
  }

  const opened = await openCase(
    db,
    {
      workspaceId: params.workspaceId,
      contactId: conversation.contact_id,
      caseTypeId: target.id,
      actorId: params.actorId,
      assignee: params.actorId,
      assigneeOnlyIfInTeam: true,
    },
    now,
  );
  if ("error" in opened) {
    await restoreFlag();
    return opened;
  }
  await clear();
  return { ok: true, caseId: opened.caseId, classified: false };
}

/**
 * Cron: reclamos detectados hace más de 30 minutos que nadie atendió (siguen
 * sin gestión protegida). Avisa una sola vez a los supervisores del equipo del
 * contacto (o a los administradores).
 */
export async function alertUnhandledComplaints(
  db: Db,
  opts: { deadline: number; now?: Date },
): Promise<{ alerted: number; stoppedEarly: boolean }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - COMPLAINT_ALERT_MINUTES * 60_000).toISOString();
  let alerted = 0;
  const typesByWorkspace = new Map<string, { id: string; name: string }[]>();

  while (Date.now() < opts.deadline) {
    const { data: due, error } = await db
      .from("conversations")
      .select("id")
      .not("complaint_flagged_at", "is", null)
      .is("complaint_alerted_at", null)
      .lte("complaint_flagged_at", cutoff)
      .order("complaint_flagged_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[cases cron] complaints", error.message);
      break;
    }
    if (!due || due.length === 0) return { alerted, stoppedEarly: false };

    // Reclamo condicional: solo avisa las filas que esta ejecución marcó.
    const { data: claimed, error: claimError } = await db
      .from("conversations")
      .update({ complaint_alerted_at: nowIso })
      .in("id", due.map((r) => r.id))
      .is("complaint_alerted_at", null)
      .not("complaint_flagged_at", "is", null)
      .select("id, workspace_id, contact_id, complaint_flagged_at, complaint_excerpt");
    if (claimError) {
      console.error("[cases cron] claim complaints", claimError.message);
      break;
    }

    const notifications: NotificationInput[] = [];
    for (const conv of claimed ?? []) {
      if (!typesByWorkspace.has(conv.workspace_id)) {
        typesByWorkspace.set(conv.workspace_id, await protectedTypes(db, conv.workspace_id));
      }
      const typeIds = (typesByWorkspace.get(conv.workspace_id) ?? []).map((t) => t.id);
      const cases = await protectedCasesOf(db, conv.contact_id, typeIds);
      if (!complaintStillPending(conv.complaint_flagged_at, cases)) {
        // Ya se atendió: la marca vieja se borra para que no tape reclamos futuros.
        if (conv.complaint_flagged_at) {
          await db
            .from("conversations")
            .update({ complaint_flagged_at: null, complaint_excerpt: null })
            .eq("id", conv.id)
            .eq("complaint_flagged_at", conv.complaint_flagged_at);
        }
        continue;
      }

      const contact = await loadContact(db, conv.workspace_id, conv.contact_id);
      if (!contact) continue;
      const { data: latest } = await db
        .from("cases")
        .select("id")
        .eq("contact_id", conv.contact_id)
        .eq("status", "open")
        .order("opened_at", { ascending: false, nullsFirst: false })
        .limit(1);
      const link = latest?.[0] ? caseLink(conv.contact_id, latest[0].id) : contactLink(conv.contact_id);
      const recipients = new Set(await supervisorsOrAdmins(db, conv.workspace_id, contact.team_id));
      for (const userId of recipients) {
        notifications.push({
          workspace_id: conv.workspace_id,
          user_id: userId,
          type: "complaint_unclassified",
          title: `Posible reclamo sin atender: ${contactName(contact)}`,
          body: conv.complaint_excerpt ? `Escribió «${conv.complaint_excerpt}» y no hay una Postventa abierta.` : null,
          link,
        });
      }
      alerted++;
    }
    await notify(db, notifications);
    if (due.length < BATCH) break;
  }
  return { alerted, stoppedEarly: Date.now() >= opts.deadline };
}
