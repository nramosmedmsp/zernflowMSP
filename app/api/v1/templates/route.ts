import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, requireApiMember, type ApiContext } from "@/lib/api-auth";
import { createZernioClient } from "@/lib/zernio-client";
import { getLateApiKey } from "@/lib/workspace-secrets";
import { demoTemplates, isDemoChannel } from "@/lib/demo";
import {
  buildCreateComponents,
  summarizeTemplate,
  validateTemplateCreate,
} from "@/components/composer/whatsapp-templates";
import { zernioErrorMessage, zernioFailed } from "./zernio-error";

const NO_CHANNEL = "Conecta un canal de WhatsApp para usar plantillas.";

type Resolved =
  | { ok: true; accountId: string; apiKey: string; demo: false }
  /** Canal de prueba (lib/demo.ts): sin Zernio ni clave. */
  | { ok: true; accountId: string; apiKey: null; demo: true }
  | { ok: false; response: NextResponse };

/**
 * Canal de WhatsApp del espacio activo (con el cliente del usuario: RLS) y la
 * clave de Zernio, que se lee en el servidor y nunca sale de él.
 */
async function resolveWhatsAppChannel(
  ctx: ApiContext,
  ref: { channelId?: string | null; conversationId?: string | null },
): Promise<Resolved> {
  let channelId = ref.channelId || null;

  // Alternativa para la bandeja: el canal de la conversación (RLS decide si la ve).
  if (!channelId && ref.conversationId) {
    const { data: conversation } = await ctx.supabase
      .from("conversations")
      .select("channel_id")
      .eq("id", ref.conversationId)
      .maybeSingle();
    channelId = conversation?.channel_id ?? null;
    if (!channelId) {
      return { ok: false, response: NextResponse.json({ error: "No se encontró la conversación" }, { status: 404 }) };
    }
  }

  if (!channelId) {
    return { ok: false, response: NextResponse.json({ error: "Falta el ID del canal" }, { status: 400 }) };
  }

  const { data: channel } = await ctx.supabase
    .from("channels")
    .select("id, workspace_id, platform, late_account_id, is_active")
    .eq("id", channelId)
    .maybeSingle();

  if (!channel || channel.workspace_id !== ctx.workspaceId) {
    return { ok: false, response: NextResponse.json({ error: "No se encontró el canal" }, { status: 404 }) };
  }
  if (channel.platform !== "whatsapp" || !channel.late_account_id) {
    return { ok: false, response: NextResponse.json({ error: NO_CHANNEL }, { status: 400 }) };
  }

  if (isDemoChannel(channel)) {
    return { ok: true, accountId: channel.late_account_id, apiKey: null, demo: true };
  }

  const apiKey = await getLateApiKey(channel.workspace_id);
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "La clave de API no está configurada" }, { status: 400 }),
    };
  }
  return { ok: true, accountId: channel.late_account_id, apiKey, demo: false };
}

/**
 * GET /api/v1/templates?channelId=...   (o ?conversationId=..., para la bandeja)
 *
 * Plantillas de la cuenta de WhatsApp de ese canal (nombre, idioma, categoría,
 * estado de aprobación, cuerpo y número de variables). Cualquier miembro.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApiMember();
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const resolved = await resolveWhatsAppChannel(guard.ctx, {
    channelId: params.get("channelId"),
    conversationId: params.get("conversationId"),
  });
  if (!resolved.ok) return resolved.response;
  if (resolved.demo) return NextResponse.json({ templates: demoTemplates() });

  try {
    const zernio = createZernioClient(resolved.apiKey);
    const res = await zernio.whatsapp.getWhatsAppTemplates({ query: { accountId: resolved.accountId } });
    if (zernioFailed(res)) {
      console.error("[templates] list failed:", res.error);
      return NextResponse.json(
        { error: zernioErrorMessage(res, "No se pudieron cargar las plantillas de WhatsApp") },
        { status: 502 },
      );
    }

    const templates = (res.data?.templates ?? []).map(summarizeTemplate);
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("[templates] list error:", error);
    return NextResponse.json({ error: "No se pudieron cargar las plantillas de WhatsApp" }, { status: 500 });
  }
}

/**
 * POST /api/v1/templates
 *
 * Crea una plantilla (solo Dueño o Administrador). Body:
 * { channelId, name, language? = "es", category: "UTILITY" | "MARKETING",
 *   body, examples?: string[] } con variables {{1}}, {{2}}... en el cuerpo.
 * Meta la revisa: nace "En revisión" y se puede usar cuando queda aprobada.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApiAdmin();
  if (!guard.ok) return guard.response;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "La solicitud no es válida" }, { status: 400 });
  }

  const checked = validateTemplateCreate({
    name: typeof payload.name === "string" ? payload.name : "",
    language: typeof payload.language === "string" ? payload.language : null,
    category: typeof payload.category === "string" ? payload.category : "",
    body: typeof payload.body === "string" ? payload.body : "",
    examples: Array.isArray(payload.examples)
      ? payload.examples.map((e) => (typeof e === "string" ? e : ""))
      : null,
  });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { name, language, category, body, examples } = checked.value;

  const resolved = await resolveWhatsAppChannel(guard.ctx, {
    channelId: typeof payload.channelId === "string" ? payload.channelId : null,
  });
  if (!resolved.ok) return resolved.response;
  if (resolved.demo) {
    return NextResponse.json({ error: "En un canal de prueba no se pueden crear plantillas." }, { status: 400 });
  }

  try {
    const zernio = createZernioClient(resolved.apiKey);
    const res = await zernio.whatsapp.createWhatsAppTemplate({
      body: {
        accountId: resolved.accountId,
        name,
        category,
        language,
        components: buildCreateComponents(body, examples),
      },
    });
    if (zernioFailed(res)) {
      console.error("[templates] create failed:", res.error);
      return NextResponse.json(
        { error: zernioErrorMessage(res, "No se pudo crear la plantilla") },
        { status: 502 },
      );
    }

    const created = res.data?.template;
    return NextResponse.json(
      {
        template: {
          id: created?.id ?? null,
          name: created?.name ?? name,
          language: created?.language ?? language,
          category: (created?.category ?? category).toUpperCase(),
          status: (created?.status ?? "PENDING").toUpperCase(),
          body,
          variableCount: examples.length,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[templates] create error:", error);
    return NextResponse.json({ error: "No se pudo crear la plantilla" }, { status: 500 });
  }
}
