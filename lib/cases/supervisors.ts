// Supervisores de una gestión (control de reclamos): quién puede aprobar y a
// quién se avisa. El supervisor es el de `cases.team_id`; si el equipo no
// tiene o la gestión no tiene equipo, los administradores y el dueño.

import { isAdminRole } from "@/lib/permissions";
import {
  notify,
  supervisorsOrAdmins,
  type Db,
  type NotificationInput,
  type NotificationType,
} from "./io";

/** ¿Es administrador/dueño del espacio o supervisor del equipo? (consulta la base) */
export async function isSupervisorInDb(
  db: Db,
  target: { workspaceId: string; teamId: string | null },
  userId: string,
): Promise<boolean> {
  const { data: member } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", target.workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (isAdminRole(member?.role)) return true;
  if (!target.teamId) return false;
  const { data: team } = await db
    .from("team_members")
    .select("role")
    .eq("team_id", target.teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return team?.role === "supervisor";
}

/** Supervisores a avisar de una gestión, sin las personas excluidas (quien hizo el cambio). */
export async function supervisorRecipients(
  db: Db,
  row: { workspace_id: string; team_id: string | null },
  exclude: readonly (string | null | undefined)[] = [],
): Promise<string[]> {
  const skip = new Set(exclude.filter((id): id is string => !!id));
  const ids = await supervisorsOrAdmins(db, row.workspace_id, row.team_id);
  return [...new Set(ids)].filter((id) => !skip.has(id));
}

/** Avisa a los supervisores de la gestión (no a quien hizo el cambio). */
export async function notifySupervisors(
  db: Db,
  row: { workspace_id: string; team_id: string | null },
  note: { type: NotificationType; title: string; body?: string | null; link: string },
  options: { exclude?: readonly (string | null | undefined)[]; extra?: readonly string[] } = {},
): Promise<void> {
  const skip = new Set((options.exclude ?? []).filter((id): id is string => !!id));
  const recipients = new Set(await supervisorRecipients(db, row, options.exclude));
  for (const id of options.extra ?? []) if (!skip.has(id)) recipients.add(id);
  const rows: NotificationInput[] = [...recipients].map((userId) => ({
    workspace_id: row.workspace_id,
    user_id: userId,
    type: note.type,
    title: note.title,
    body: note.body ?? null,
    link: note.link,
  }));
  await notify(db, rows);
}
