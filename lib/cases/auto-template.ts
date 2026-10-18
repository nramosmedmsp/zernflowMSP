// Plantilla automática al activarse una gestión proactiva
// (docs/FASE-2-TECNICO.md 3.4). La llama el cron al activar una gestión
// programada cuyo tipo tiene `auto_template`:
// - si el contacto tiene teléfono de WhatsApp y hay un canal de WhatsApp, se
//   envía la plantilla con sus variables reemplazadas, se sella
//   auto_template_sent_at y last_outbound_at (salida del bot), se registra en
//   activity y la gestión pasa a la segunda etapa abierta;
// - si falla, queda en la primera etapa, se registra y se avisa al
//   responsable (o a supervisores/administradores si no tiene).

import { displayName } from "@/lib/team-rules";
import { applyReplyVariables } from "@/lib/saved-replies";
import type { CaseTypeAutoTemplate } from "@/lib/types/database";
import {
  TEMPLATE_PARAM_MAX,
  phoneDigits,
  sanitizeTemplateParam,
  type BuildParamsResult,
} from "@/lib/whatsapp-templates";
import { loadAssignmentContext, type AssignmentContextCache } from "./assign";
import { changeStage } from "./changes";
import { isDateString } from "./dates";
import {
  caseLink,
  contactName,
  loadCase,
  loadCaseType,
  loadContact,
  logActivity,
  notify,
  supervisorsOrAdmins,
  type Db,
} from "./io";
import { zernioMessenger, type CaseMessenger } from "./messaging";

export const MAX_AUTO_TEMPLATE_PARAMS = 20;

/** case_types.auto_template normalizado, o null si no está o no sirve. */
export function parseAutoTemplate(raw: unknown): CaseTypeAutoTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.template_name === "string" ? r.template_name.trim() : "";
  const language = typeof r.language === "string" ? r.language.trim() : "";
  if (!name || !language) return null;
  const params = Array.isArray(r.params) ? r.params.filter((p): p is string => typeof p === "string") : [];
  return { template_name: name, language, params: params.slice(0, MAX_AUTO_TEMPLATE_PARAMS) };
}

/** "2026-11-30" → "30/11/2026" (sin pasar por zonas horarias). */
export function formatKeyDate(value: string | null | undefined): string {
  if (!isDateString(value)) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

export interface AutoTemplateVars {
  contactName?: string | null;
  keyDate?: string | null;
  workspaceName?: string | null;
  teamName?: string | null;
  agentName?: string | null;
  /** Campos personalizados por slug ({campo:slug}). */
  customFields?: Record<string, string>;
}

/**
 * Valores de la plantilla: reemplaza {nombre}, {fecha_clave}, {empresa},
 * {sede}, {asesor} y {campo:slug}. WhatsApp no acepta valores vacíos: si una
 * variable queda vacía, devuelve el error.
 */
export function buildAutoTemplateParams(template: CaseTypeAutoTemplate, vars: AutoTemplateVars): BuildParamsResult {
  const params: string[] = [];
  const keyDate = formatKeyDate(vars.keyDate);
  for (let i = 0; i < template.params.length; i++) {
    const raw = template.params[i];
    const replaced = applyReplyVariables(raw.replace(/\{fecha_clave\}/gi, keyDate), {
      contactName: vars.contactName ?? undefined,
      workspaceName: vars.workspaceName ?? undefined,
      teamName: vars.teamName ?? undefined,
      agentName: vars.agentName ?? undefined,
      customFields: vars.customFields,
    });
    const value = sanitizeTemplateParam(replaced);
    if (!value) return { ok: false, error: `La variable ${i + 1} de la plantilla ("${raw}") quedó vacía para este contacto.` };
    if (value.length > TEMPLATE_PARAM_MAX) return { ok: false, error: `La variable ${i + 1} de la plantilla es demasiado larga.` };
    params.push(value);
  }
  return { ok: true, params };
}

export type AutoTemplateOutcome =
  | { status: "none" }
  | { status: "sent"; params: string[] }
  | { status: "skipped"; reason: "not_open" | "already_sent" | "no_whatsapp_channel" | "no_phone" }
  | { status: "failed"; error: string };

interface WhatsAppTarget {
  channelId: string | null;
  lateAccountId: string | null;
  phone: string;
}

/** Canal de WhatsApp y teléfono: el canal donde ya escribió, o el primero activo con contacts.phone. */
async function whatsappTarget(db: Db, workspaceId: string, contactId: string, contactPhone: string | null): Promise<WhatsAppTarget> {
  const { data: channels } = await db
    .from("channels")
    .select("id, late_account_id, platform, is_active")
    .eq("workspace_id", workspaceId)
    .eq("platform", "whatsapp")
    .eq("is_active", true);
  const list = channels ?? [];
  if (list.length === 0) return { channelId: null, lateAccountId: null, phone: "" };
  const { data: links } = await db
    .from("contact_channels")
    .select("channel_id, platform_sender_id")
    .eq("contact_id", contactId)
    .in(
      "channel_id",
      list.map((c) => c.id),
    );
  for (const link of links ?? []) {
    const channel = list.find((c) => c.id === link.channel_id);
    const phone = phoneDigits(link.platform_sender_id);
    if (channel && phone) return { channelId: channel.id, lateAccountId: channel.late_account_id, phone };
  }
  return { channelId: list[0].id, lateAccountId: list[0].late_account_id, phone: phoneDigits(contactPhone) };
}

async function customFieldsOf(db: Db, workspaceId: string, contactId: string): Promise<Record<string, string>> {
  const [{ data: defs }, { data: values }] = await Promise.all([
    db.from("custom_field_definitions").select("id, slug").eq("workspace_id", workspaceId),
    db.from("contact_custom_fields").select("field_id, value").eq("contact_id", contactId),
  ]);
  const slugs = new Map((defs ?? []).map((d) => [d.id, d.slug]));
  const out: Record<string, string> = {};
  for (const v of values ?? []) {
    const slug = slugs.get(v.field_id);
    if (slug) out[slug] = v.value;
  }
  return out;
}

export async function sendAutoTemplate(
  db: Db,
  params: { caseId: string; at: string; messenger?: CaseMessenger; cache?: AssignmentContextCache },
): Promise<AutoTemplateOutcome> {
  const row = await loadCase(db, params.caseId);
  if (!row || row.status !== "open") return { status: "skipped", reason: "not_open" };
  if (!row.case_type_id) return { status: "none" };
  if (row.auto_template_sent_at) return { status: "skipped", reason: "already_sent" };
  const type = await loadCaseType(db, row.workspace_id, row.case_type_id);
  const template = parseAutoTemplate(type?.auto_template);
  if (!type || !template) return { status: "none" };

  const contact = await loadContact(db, row.workspace_id, row.contact_id);
  if (!contact) return { status: "skipped", reason: "not_open" };
  const base = { workspace_id: row.workspace_id, case_id: row.id, contact_id: row.contact_id };

  const target = await whatsappTarget(db, row.workspace_id, contact.id, contact.phone);
  if (!target.lateAccountId || !target.phone) {
    const reason = !target.lateAccountId ? "no_whatsapp_channel" : "no_phone";
    await logActivity(db, { ...base, type: "auto_template_skipped", meta: { template_name: template.template_name, reason } });
    return { status: "skipped", reason };
  }

  const ctx = await loadAssignmentContext(db, row.workspace_id, params.cache);
  const needs = (token: string) => template.params.some((p) => p.toLowerCase().includes(token));
  let agentName: string | null = null;
  if (row.assignee_id && needs("{asesor}")) {
    const { data } = await db.auth.admin.getUserById(row.assignee_id);
    agentName = data?.user ? displayName({ id: data.user.id, email: data.user.email ?? "", user_metadata: data.user.user_metadata }) : null;
  }
  const built = buildAutoTemplateParams(template, {
    contactName: contact.display_name,
    keyDate: contact.key_date,
    workspaceName: ctx.hours.workspaceName,
    teamName: row.team_id ? ctx.hours.teamNames.get(row.team_id) : null,
    agentName,
    customFields: needs("{campo:") ? await customFieldsOf(db, row.workspace_id, contact.id) : undefined,
  });

  const sent = built.ok
    ? await (params.messenger ?? zernioMessenger(db)).sendTemplate({
        workspaceId: row.workspace_id,
        lateAccountId: target.lateAccountId,
        phone: target.phone,
        templateName: template.template_name,
        language: template.language,
        params: built.params,
      })
    : ({ ok: false, error: built.error } as const);

  if (!sent.ok) {
    await logActivity(db, {
      ...base,
      type: "auto_template_failed",
      meta: { template_name: template.template_name, error: sent.error },
    });
    const recipients = row.assignee_id
      ? [row.assignee_id]
      : await supervisorsOrAdmins(db, row.workspace_id, row.team_id);
    await notify(
      db,
      recipients.map((userId) => ({
        workspace_id: row.workspace_id,
        user_id: userId,
        type: "auto_template_failed" as const,
        title: `No se pudo enviar la plantilla: ${contactName(contact)}`,
        body: `${type.name}: ${sent.error} Contáctalo manualmente.`,
        link: caseLink(row.contact_id, row.id),
      })),
    );
    return { status: "failed", error: sent.error };
  }

  const okParams = built.ok ? built.params : [];
  const { error } = await db
    .from("cases")
    .update({ auto_template_sent_at: params.at, last_outbound_at: params.at })
    .eq("id", row.id);
  if (error) console.error("[cases] auto template stamp", error.message);
  await logActivity(db, {
    ...base,
    type: "auto_template_sent",
    meta: {
      template_name: template.template_name,
      language: template.language,
      params: okParams,
      message_id: sent.messageId,
    },
  });
  if (target.channelId) {
    await db
      .from("conversations")
      .update({ last_message_at: params.at, last_message_preview: `Plantilla: ${template.template_name}` })
      .eq("contact_id", contact.id)
      .eq("channel_id", target.channelId);
  }

  // Segunda etapa abierta ("Recordatorio enviado" / "Contactado").
  const { data: stages } = await db
    .from("case_stages")
    .select("id, position")
    .eq("case_type_id", type.id)
    .eq("kind", "open")
    .is("archived_at", null)
    .order("position", { ascending: true });
  const open = stages ?? [];
  if (open.length >= 2 && (row.stage_id === null || row.stage_id === open[0].id)) {
    const moved = await changeStage(db, { caseId: row.id, stageId: open[1].id, actorId: null });
    if ("error" in moved) console.error("[cases] auto template stage", moved.error);
  }
  return { status: "sent", params: okParams };
}
