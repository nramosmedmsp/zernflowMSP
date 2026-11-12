// Categoría de una plantilla de WhatsApp: ¿es de servicio o de publicidad?
//
// Zernio devuelve cada plantilla con el campo `category` de Meta
// (getWhatsAppTemplate -> data.template.category; también viene en la lista de
// plantillas, ver summarizeTemplate): UTILITY (pedido, pago, entrega),
// AUTHENTICATION (códigos) o MARKETING (publicidad). UTILITY y AUTHENTICATION
// cuentan como "servicio"; MARKETING, como "publicidad".
//
// Si no se puede saber la categoría (la plantilla no existe, Zernio no
// responde, falta la clave...), se trata como PUBLICIDAD, que es lo seguro, y
// quien la envía lo ve en pantalla con palabras claras (UNKNOWN_CATEGORY_NOTICE
// en lib/consent.ts).

import { demoTemplates, isDemoChannel } from "@/lib/demo";
import { getLateApiKey } from "@/lib/workspace-secrets";
import type { Db } from "@/lib/cases/io";

export type TemplateKind = "service" | "marketing" | "unknown";

/** "service" (UTILITY, AUTHENTICATION), "marketing" (MARKETING) o "unknown" (cualquier otra cosa). */
export function templateKindFromCategory(category: unknown): TemplateKind {
  const value = typeof category === "string" ? category.trim().toUpperCase() : "";
  if (value === "UTILITY" || value === "AUTHENTICATION") return "service";
  if (value === "MARKETING") return "marketing";
  return "unknown";
}

/** Una plantilla cuenta como publicidad salvo que se sepa que es de servicio. */
export function isPublicityKind(kind: TemplateKind): boolean {
  return kind !== "service";
}

/** Categoría de una plantilla de un canal de prueba (lib/demo.ts). */
export function demoTemplateKind(templateName: string): TemplateKind {
  const found = demoTemplates().find((t) => t.name === templateName);
  return found ? templateKindFromCategory(found.category) : "unknown";
}

// ── Lectura desde Zernio, con una memoria corta ────────────────────────────

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { kind: TemplateKind; until: number }>();

/** Solo para pruebas. */
export function clearTemplateKindCache(): void {
  cache.clear();
}

/** Lo mínimo del cliente de Zernio que se usa (para poder probarlo sin red). */
export interface TemplateReader {
  whatsapp: {
    getWhatsAppTemplate(input: {
      path: { templateName: string };
      query: { accountId: string };
    }): Promise<{ data?: { template?: { category?: unknown } | null } | null; error?: unknown }>;
  };
}

/**
 * Categoría de la plantilla en la cuenta de WhatsApp. Un fallo devuelve
 * "unknown" (y no se recuerda, para volver a intentar en el próximo envío).
 */
export async function readTemplateKind(
  reader: TemplateReader,
  accountId: string,
  templateName: string,
  now: number = Date.now(),
): Promise<TemplateKind> {
  const key = `${accountId}\u0000${templateName}`;
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.kind;
  try {
    const res = await reader.whatsapp.getWhatsAppTemplate({ path: { templateName }, query: { accountId } });
    if (res.error || !res.data?.template) return "unknown";
    const kind = templateKindFromCategory(res.data.template.category);
    if (kind !== "unknown") cache.set(key, { kind, until: now + CACHE_MS });
    return kind;
  } catch (err) {
    console.error("[template-category] no se pudo leer la plantilla:", err instanceof Error ? err.message : err);
    return "unknown";
  }
}

/**
 * Categoría de una plantilla para enviarla desde el servidor (difusiones,
 * plantilla automática de las gestiones): canal de prueba -> su lista; canal
 * real -> Zernio con la clave del espacio.
 */
export async function resolveTemplateKind(
  db: Db,
  params: { workspaceId: string; lateAccountId: string | null; templateName: string },
): Promise<TemplateKind> {
  if (!params.lateAccountId) return "unknown";
  if (isDemoChannel(params.lateAccountId)) return demoTemplateKind(params.templateName);
  try {
    const apiKey = await getLateApiKey(params.workspaceId, db);
    if (!apiKey) return "unknown";
    const { createZernioClient } = await import("@/lib/zernio-client");
    return await readTemplateKind(
      createZernioClient(apiKey) as unknown as TemplateReader,
      params.lateAccountId,
      params.templateName,
    );
  } catch (err) {
    console.error("[template-category] resolveTemplateKind", err instanceof Error ? err.message : err);
    return "unknown";
  }
}
