// Registro de acciones sensibles (SEG-05). Usa el MISMO mecanismo que ya tenía
// lib/actions/team.ts (member_readded): una fila en `activity` con
// type "config_changed" y en `meta` la acción, la entidad y los datos útiles.
//
// Regla de oro: NUNCA se guarda una clave, un secreto, un token ni un enlace de
// acceso. `logAudit` descarta del `meta` cualquier campo con nombre de secreto,
// y quien llama solo debe pasar identificadores, roles y conteos.

import { logActivity, type Db } from "@/lib/cases/io";

export type AuditAction =
  | "member_created"
  | "access_link_copied"
  | "access_email_sent"
  | "api_key_changed"
  | "channel_connect_started"
  | "channels_synced"
  | "channel_deleted"
  | "channel_toggled"
  | "broadcast_launched"
  | "broadcast_paused"
  | "broadcast_resumed"
  | "broadcast_cancelled"
  | "broadcast_auto_paused"
  | "data_exported"
  | "workspace_settings_changed"
  | "flow_deleted"
  | "flow_published";

export type AuditEntity = "team" | "secrets" | "channel" | "broadcast" | "export" | "workspace" | "flow";

export interface AuditInput {
  workspaceId: string;
  /** Quién lo hizo; `null` cuando lo hace el sistema (por ejemplo, una pausa automática). */
  actorId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  fromValue?: string | null;
  toValue?: string | null;
  meta?: Record<string, unknown>;
}

/** Nombres de campo que nunca deben entrar al registro. */
const SECRET_FIELD = /key|secret|token|password|contrasena|clave|authorization|bearer|link|url|hash/i;
const MAX_TEXT = 200;

/** Quita campos con nombre de secreto y acota los textos largos. Solo valores simples. */
export function sanitizeAuditMeta(meta: Record<string, unknown> = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [name, value] of Object.entries(meta)) {
    if (SECRET_FIELD.test(name)) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") out[name] = value;
    else if (typeof value === "string") out[name] = value.slice(0, MAX_TEXT);
  }
  return out;
}

/** Las filas que se guardan en `activity` (separado para probarlo sin base). */
export function auditRow(input: AuditInput) {
  return {
    workspace_id: input.workspaceId,
    type: "config_changed" as const,
    actor_id: input.actorId,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    meta: { ...sanitizeAuditMeta(input.meta), action: input.action, entity: input.entity },
  };
}

/** Registra la acción. Un fallo se anota en el log y no corta la operación (igual que logActivity). */
export async function logAudit(db: unknown, input: AuditInput): Promise<void> {
  try {
    await logActivity(db as Db, auditRow(input));
  } catch (err) {
    console.error("[audit] no se pudo registrar la acción", input.action, err);
  }
}
