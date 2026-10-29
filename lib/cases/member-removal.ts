// R2-2: qué pasa con el trabajo de una persona que se quita del espacio.
// Sus gestiones abiertas o programadas vuelven a la cola y se reparten entre
// quienes quedan (si no hay nadie, avisan a supervisores y administradores),
// deja de ser responsable de contactos y sale de todos los equipos. Se llama
// DESPUÉS de borrar su fila de workspace_members (así el reparto no la elige).

import { assignCase } from "./assign";
import { contactName, logActivity, notify, type Db } from "./io";

export interface MemberRemovalStats {
  releasedCases: number;
  reassigned: number;
  contactsFreed: number;
  teamsLeft: number;
}

export async function releaseMemberWork(
  db: Db,
  params: { workspaceId: string; userId: string; actorId: string | null },
): Promise<MemberRemovalStats> {
  const { workspaceId, userId, actorId } = params;
  const stats: MemberRemovalStats = { releasedCases: 0, reassigned: 0, contactsFreed: 0, teamsLeft: 0 };

  // 1. Fuera de todos los equipos del espacio.
  const { data: teams } = await db.from("teams").select("id").eq("workspace_id", workspaceId);
  const teamIds = (teams ?? []).map((t) => t.id);
  if (teamIds.length > 0) {
    const { data: left, error } = await db
      .from("team_members")
      .delete()
      .eq("user_id", userId)
      .in("team_id", teamIds)
      .select("team_id");
    if (error) console.error("[cases] remove team memberships", error.message);
    stats.teamsLeft = (left ?? []).length;
  }

  // 2. Gestiones abiertas o programadas: vuelven a la cola y se reparten.
  const { data: cases, error: casesError } = await db
    .from("cases")
    .select("id, contact_id, status")
    .eq("workspace_id", workspaceId)
    .eq("assignee_id", userId)
    .in("status", ["open", "scheduled"]);
  if (casesError) console.error("[cases] cases of removed member", casesError.message);
  for (const row of cases ?? []) {
    const { data: released } = await db
      .from("cases")
      .update({ assignee_id: null })
      .eq("id", row.id)
      .eq("assignee_id", userId)
      .select("id");
    if (!released || released.length === 0) continue;
    stats.releasedCases++;
    await logActivity(db, {
      workspace_id: workspaceId,
      type: "unassigned",
      case_id: row.id,
      contact_id: row.contact_id,
      actor_id: actorId,
      from_value: userId,
      to_value: null,
      meta: { reason: "member_removed" },
    });
    if (row.status !== "open") continue; // las programadas se reparten al activarse
    const outcome = await assignCase(db, row.id, { actorId, exclude: [userId], reason: "member_removed" });
    if (outcome.status === "assigned") stats.reassigned++;
  }

  // 3. Responsable de contactos: pasan a "sin responsable".
  const { data: contacts, error: contactsError } = await db
    .from("contacts")
    .update({ owner_id: null })
    .eq("workspace_id", workspaceId)
    .eq("owner_id", userId)
    .select("id, display_name");
  if (contactsError) console.error("[cases] contacts of removed member", contactsError.message);
  stats.contactsFreed = (contacts ?? []).length;
  if (stats.contactsFreed > 0) {
    await logActivity(
      db,
      (contacts ?? []).map((c) => ({
        workspace_id: workspaceId,
        type: "owner_changed" as const,
        contact_id: c.id,
        actor_id: actorId,
        from_value: userId,
        to_value: null,
        meta: { reason: "member_removed", name: contactName(c) },
      })),
    );
  }

  // Aviso a quien lo quitó con un resumen (sirve de rastro; no molesta a nadie más).
  if (actorId && (stats.releasedCases > 0 || stats.contactsFreed > 0)) {
    await notify(db, [
      {
        workspace_id: workspaceId,
        user_id: actorId,
        type: "case_reassigned",
        title: "Se repartió el trabajo de la persona que quitaste",
        body: `${stats.releasedCases} gestión(es) volvieron a la cola (${stats.reassigned} ya reasignada(s)) y ${stats.contactsFreed} contacto(s) quedaron sin responsable.`,
      },
    ]);
  }
  return stats;
}
