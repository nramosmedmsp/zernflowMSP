// Descarga de archivos entrantes sin seguir redirecciones a ciegas (SEG-11).
//
// `fetch` con redirect "follow" iría a CUALQUIER destino al que apunte la
// respuesta (y reenviaría la clave de Zernio). Aquí cada salto se pide con
// redirect "manual" y su destino se revalida con inboundFetchPlan (https y
// lista de hosts permitidos). Reglas:
//   * máximo MAX_REDIRECTS saltos;
//   * un destino fuera de la lista corta la descarga (se anota solo el host);
//   * la clave de Zernio viaja únicamente al host exacto de la primera
//     petición: si la redirección cambia de host, el salto siguiente va sin ella.

import { inboundFetchPlan } from "@/lib/chat-media";

export const MAX_REDIRECTS = 3;

export interface SafeFetchOptions {
  /** Clave de Zernio; solo se manda a hosts de zernio.com que la piden. */
  apiKey: string | null;
  signal?: AbortSignal;
  /** Para pruebas. */
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Pide el archivo revalidando cada salto. Devuelve la respuesta final (que
 * puede ser un error HTTP, como con fetch) o null si el destino no está
 * permitido, la redirección es inválida o hay demasiados saltos.
 */
export async function fetchInboundSafely(startUrl: string, options: SafeFetchOptions): Promise<Response | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const limit = options.maxRedirects ?? MAX_REDIRECTS;
  const originHost = hostOf(startUrl);
  let url = startUrl;

  for (let hop = 0; hop <= limit; hop++) {
    const plan = inboundFetchPlan(url);
    if (!plan.ok) {
      if (hop > 0) console.warn(`[media] redirección bloqueada: el destino ${hostOf(url) || "inválido"} no está permitido`);
      return null;
    }
    // La clave solo a zernio.com y solo al host al que se pidió primero.
    const withKey = plan.withApiKey && hostOf(url) === originHost;
    if (plan.withApiKey && !options.apiKey && hop === 0) return null;
    const res = await doFetch(url, {
      headers: withKey && options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
      signal: options.signal,
      redirect: "manual",
    });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location) return null;
    try {
      url = new URL(location, url).toString();
    } catch {
      return null;
    }
  }
  console.warn("[media] demasiadas redirecciones");
  return null;
}
