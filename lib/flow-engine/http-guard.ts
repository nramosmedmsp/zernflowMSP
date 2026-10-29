// Seguridad del nodo "Solicitud HTTP" de los flujos (M-2): solo https, nunca
// hacia direcciones internas (la propia máquina, redes privadas, el servicio
// de metadatos de la nube), con tiempo límite y tamaño máximo de respuesta.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const HTTP_NODE_TIMEOUT_MS = 10_000;
export const HTTP_NODE_MAX_RESPONSE_BYTES = 1_000_000;

/** IPv4 en cuatro números, o null si no lo es. */
function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map((p) => Number(p));
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** ¿Es una IP que no debe alcanzarse desde el servidor (privada, local, reservada)? */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 || // "esta red"
      a === 10 ||
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // enlace local y metadatos de la nube
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast y reservadas
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4 dentro de IPv6 (::ffff:10.0.0.1).
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    v6.startsWith("fc") || // únicas locales
    v6.startsWith("fd") ||
    v6.startsWith("fe8") || // enlace local
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff") // multicast
  );
}

export type HttpTargetCheck = { ok: true; url: URL } | { ok: false; error: string };

type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

/**
 * Revisa la dirección de la solicitud: https, sin usuario ni contraseña, un
 * nombre de host público (también después de resolver su DNS).
 */
export async function checkHttpTarget(rawUrl: string, resolve: Resolver = defaultResolver): Promise<HttpTargetCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "La dirección no es válida." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Solo se permiten direcciones https." };
  if (url.username || url.password) return { ok: false, error: "La dirección no puede llevar usuario ni contraseña." };

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return { ok: false, error: "La dirección no es válida." };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !isIP(host)) {
    return { ok: false, error: "No se permiten direcciones internas." };
  }
  if (isIP(host)) {
    return isBlockedIp(host) ? { ok: false, error: "No se permiten direcciones internas." } : { ok: true, url };
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, error: "No se pudo resolver la dirección." };
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    return { ok: false, error: "No se permiten direcciones internas." };
  }
  return { ok: true, url };
}

/** Lee el cuerpo como texto sin pasar de `cap` bytes (el resto se descarta). */
export async function readTextCapped(res: Response, cap: number = HTTP_NODE_MAX_RESPONSE_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, cap);
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (total >= cap) {
      await reader.cancel();
      break;
    }
  }
  return text.slice(0, cap);
}
