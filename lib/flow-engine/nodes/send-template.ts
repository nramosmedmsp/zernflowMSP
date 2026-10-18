// Envío de una plantilla de WhatsApp desde el nodo Enviar mensaje
// (docs/FASE-2-TECNICO.md 4): se usa cuando la ventana de 24 h está cerrada y
// el nodo tiene una plantilla. Reutiliza el armado de variables de la
// plantilla automática de las gestiones y el envío por Zernio de lib/cases.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildAutoTemplateParams, customFieldsOf } from "@/lib/cases/auto-template";
import { zernioMessenger, type CaseMessenger } from "@/lib/cases/messaging";
import { phoneDigits } from "@/lib/whatsapp-templates";
import { CASE_ID_VARIABLE } from "../case-trigger-match";
import type { NodeTemplate } from "../send-mode";
import type { FlowExecutionContext } from "../types";

type Db = SupabaseClient<Database>;

export type FlowTemplateResult = { ok: true; params: string[]; messageId: string | null } | { ok: false; error: string };

/** Reemplaza las variables {{x}} de la sesión dentro de los valores de la plantilla. */
function fillSessionVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (token, name: string) => variables[name] ?? token);
}

export async function sendFlowTemplate(
  db: Db,
  context: FlowExecutionContext,
  template: NodeTemplate,
  lateAccountId: string,
  messenger: CaseMessenger = zernioMessenger(db),
): Promise<FlowTemplateResult> {
  const [{ data: contact }, { data: link }, { data: workspace }] = await Promise.all([
    db.from("contacts").select("display_name, phone, key_date").eq("id", context.contactId).maybeSingle(),
    db
      .from("contact_channels")
      .select("platform_sender_id")
      .eq("contact_id", context.contactId)
      .eq("channel_id", context.channelId)
      .maybeSingle(),
    db.from("workspaces").select("name").eq("id", context.workspaceId).maybeSingle(),
  ]);
  if (!contact) return { ok: false, error: "El contacto no existe." };
  const phone = phoneDigits(link?.platform_sender_id) || phoneDigits(contact.phone);
  if (!phone) return { ok: false, error: "El contacto no tiene un número de WhatsApp." };

  // Equipo de la gestión (para {sede}).
  let teamName: string | null = null;
  const caseId = context.variables?.[CASE_ID_VARIABLE];
  const { data: caseRow } = caseId
    ? await db.from("cases").select("team_id").eq("id", caseId).maybeSingle()
    : await db
        .from("cases")
        .select("team_id")
        .eq("contact_id", context.contactId)
        .eq("status", "open")
        .order("opened_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
  if (caseRow?.team_id) {
    const { data: team } = await db.from("teams").select("name").eq("id", caseRow.team_id).maybeSingle();
    teamName = team?.name ?? null;
  }

  const variables = context.variables ?? {};
  const needsCustom = template.params.some((p) => p.toLowerCase().includes("{campo:"));
  const built = buildAutoTemplateParams(
    { ...template, params: template.params.map((p) => fillSessionVariables(p, variables)) },
    {
      contactName: contact.display_name,
      keyDate: contact.key_date,
      workspaceName: workspace?.name ?? null,
      teamName,
      customFields: needsCustom ? await customFieldsOf(db, context.workspaceId, context.contactId) : undefined,
    },
  );
  if (!built.ok) return { ok: false, error: built.error };

  const sent = await messenger.sendTemplate({
    workspaceId: context.workspaceId,
    lateAccountId,
    phone,
    templateName: template.template_name,
    language: template.language,
    params: built.params,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, params: built.params, messageId: sent.messageId };
}
