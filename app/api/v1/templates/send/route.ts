import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireApiMember } from "@/lib/api-auth";
import { handleHumanOutboundForConversation } from "@/lib/cases";
import { createZernioClient } from "@/lib/zernio-client";
import { messagePreview } from "@/lib/message-preview";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { demoTemplateText, isDemoChannel } from "@/lib/demo";
import { storeDemoMessage } from "@/lib/demo-messages";
import {
  TEMPLATE_PARAM_MAX,
  fillPlaceholders,
  phoneDigits,
  summarizeTemplate,
} from "@/components/composer/whatsapp-templates";
import { zernioErrorMessage, zernioFailed } from "../zernio-error";

const MAX_PARAMS = 20;

/**
 * POST /api/v1/templates/send
 *
 * { conversationId, templateName, language, params: string[] }
 *
 * Envía una plantilla aprobada de WhatsApp en esa conversación (la única
 * forma de escribir cuando pasaron más de 24 h desde el último mensaje del
 * contacto). `params` es el arreglo plano de valores en el orden de la
 * plantilla: encabezado, cuerpo y botones de enlace.
 *
 * Nota sobre Zernio: `sendInboxMessage` (la ruta de mensajes normales) pide
 * armar a mano los componentes de Meta; `createInboxConversation` recibe
 * `templateName`, `templateLanguage` y `templateParams` planos y completa solo
 * los encabezados con imagen o video, y devuelve el mismo ID de conversación
 * que ya tenemos. Por eso se envía con esa.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiMember();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard.ctx;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "La solicitud no es válida" }, { status: 400 });
  }

  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  const templateName = typeof payload.templateName === "string" ? payload.templateName.trim() : "";
  const language = typeof payload.language === "string" ? payload.language.trim() : "";
  const rawParams = payload.params ?? [];

  if (!conversationId || !templateName || !language) {
    return NextResponse.json(
      { error: "Faltan la conversación, el nombre de la plantilla y el idioma" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(rawParams) ||
    rawParams.length > MAX_PARAMS ||
    rawParams.some((p) => typeof p !== "string" || !p.trim() || p.length > TEMPLATE_PARAM_MAX)
  ) {
    return NextResponse.json(
      { error: "Completa todas las variables de la plantilla (no pueden estar vacías)" },
      { status: 400 },
    );
  }
  const params = (rawParams as string[]).map((p) => p.trim());

  // Con el cliente del usuario: RLS (can_see_contact) decide si ve la conversación.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, contact_id, platform, channels(late_account_id, platform)")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "No se encontró la conversación" }, { status: 404 });
  }

  const channel = conversation.channels as { late_account_id: string; platform: string } | null;
  if (!channel?.late_account_id) {
    return NextResponse.json({ error: "No se encontró el canal o le falta el ID de cuenta de Zernio" }, { status: 404 });
  }
  if (conversation.platform !== "whatsapp" || channel.platform !== "whatsapp") {
    return NextResponse.json({ error: "Las plantillas solo se pueden enviar por WhatsApp" }, { status: 400 });
  }

  // Canal de prueba (lib/demo.ts): se guarda el texto de la plantilla con sus
  // variables en lugar de enviarlo.
  if (isDemoChannel(channel)) {
    const service = await createServiceClient();
    const sentAt = new Date().toISOString();
    const text = demoTemplateText(templateName, params);
    const stored = await storeDemoMessage(service, {
      conversationId,
      direction: "outbound",
      text,
      at: sentAt,
      sentByUserId: user.id,
    });
    if (!stored.ok) {
      console.error("[templates/send] demo store:", stored.error);
      return NextResponse.json({ error: "No se pudo guardar la plantilla de prueba" }, { status: 500 });
    }
    try {
      await handleHumanOutboundForConversation(service, { conversationId, userId: user.id, at: sentAt });
    } catch (err) {
      console.error("Case engine (handleHumanOutbound) error:", err);
    }
    return NextResponse.json(
      {
        id: stored.messageId,
        conversation_id: conversationId,
        direction: "outbound",
        text,
        attachments: null,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: null,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        created_at: sentAt,
      },
      { status: 201 },
    );
  }

  // La clave se lee en el servidor con el cliente de servicio, solo después de
  // comprobar (vía RLS) que el usuario ve la conversación.
  const lateApiKey = await getLateApiKey(conversation.workspace_id);
  if (!lateApiKey) {
    return NextResponse.json({ error: "La clave de API no está configurada" }, { status: 400 });
  }

  // Teléfono del contacto en este canal (la lectura ya está autorizada arriba).
  const service = await createServiceClient();
  const [{ data: contactChannel }, { data: contact }] = await Promise.all([
    service
      .from("contact_channels")
      .select("platform_sender_id")
      .eq("contact_id", conversation.contact_id)
      .eq("channel_id", conversation.channel_id)
      .maybeSingle(),
    service.from("contacts").select("phone").eq("id", conversation.contact_id).maybeSingle(),
  ]);
  const phone = phoneDigits(contactChannel?.platform_sender_id) || phoneDigits(contact?.phone);
  if (!phone) {
    return NextResponse.json({ error: "El contacto no tiene un número de WhatsApp" }, { status: 400 });
  }

  try {
    const zernio = createZernioClient(lateApiKey);
    const res = await zernio.messages.createInboxConversation({
      body: {
        accountId: channel.late_account_id,
        participantId: phone,
        templateName,
        templateLanguage: language,
        ...(params.length > 0 ? { templateParams: params } : {}),
      },
    });

    if (zernioFailed(res)) {
      console.error("[templates/send] Zernio error:", res.error);
      return NextResponse.json(
        { error: zernioErrorMessage(res, "No se pudo enviar la plantilla") },
        { status: 502 },
      );
    }

    const messageId = res.data?.data?.messageId ?? null;
    const sentAt = new Date().toISOString();

    // Texto para mostrar en la lista de conversaciones: el cuerpo ya con los
    // valores. Si no se puede leer la plantilla, se muestra su nombre.
    let text = `Plantilla: ${templateName}`;
    try {
      const detail = await zernio.whatsapp.getWhatsAppTemplate({
        path: { templateName },
        query: { accountId: channel.late_account_id },
      });
      if (!zernioFailed(detail) && detail.data?.template) {
        const summary = summarizeTemplate(detail.data.template);
        const headerCount = summary.slots.filter((s) => s.section === "header").length;
        if (summary.body) text = fillPlaceholders(summary.body, params, headerCount);
      }
    } catch (err) {
      console.error("[templates/send] no se pudo leer la plantilla para la vista previa:", err);
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: sentAt, last_message_preview: messagePreview(text) })
      .eq("id", conversationId);

    // Respuesta humana (docs/FASE-1-TECNICO.md 3.2): igual que messages/route.ts.
    // Si falla, la plantilla ya salió: solo se registra el error.
    try {
      await handleHumanOutboundForConversation(service, { conversationId, userId: user.id, at: sentAt });
    } catch (err) {
      console.error("Case engine (handleHumanOutbound) error:", err);
    }

    return NextResponse.json(
      {
        id: messageId ?? `sent-${Date.now()}`,
        conversation_id: conversationId,
        direction: "outbound",
        text,
        attachments: null,
        quick_reply_payload: null,
        postback_payload: null,
        callback_data: null,
        platform_message_id: messageId,
        sent_by_flow_id: null,
        sent_by_node_id: null,
        sent_by_user_id: user.id,
        status: "sent",
        created_at: sentAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[templates/send] error:", error);
    return NextResponse.json({ error: "No se pudo enviar la plantilla" }, { status: 500 });
  }
}
