// Topes de frecuencia por usuario (SEG-01).
//
// Las funciones de Vercel no comparten memoria: el contador vive en la base
// (migración 00043, función rate_limit_hit), de ventana fija y atómico. Este
// archivo es el ÚNICO ayudante: define los límites con nombre y decide si una
// petición pasa. No importa nada del servidor de Next, así que se prueba con
// un cliente falso; el envoltorio con la respuesta 429 está en
// lib/rate-limit-http.ts.
//
// Si el contador falla (base caída, migración sin aplicar) NO se bloquea el
// trabajo: se deja pasar y se registra el fallo en el log.

import { createHash } from "node:crypto";

/** Mensaje que ve la persona cuando se pasa de un tope. */
export const RATE_LIMIT_MESSAGE = "Vas muy rápido. Espera un momento y vuelve a intentar.";

export interface RateWindow {
  /** Cuántas veces se permite dentro de la ventana. */
  limit: number;
  /** Duración de la ventana fija, en segundos. */
  seconds: number;
}

export interface RateRule {
  /** Nombre corto y estable; forma parte de la clave del contador. */
  name: string;
  /** Todas las ventanas deben cumplirse (por ejemplo, por minuto y por hora). */
  windows: readonly RateWindow[];
}

const MINUTE = 60;
const HOUR = 3600;

function rule(name: string, windows: RateWindow[]): RateRule {
  return { name, windows };
}

/**
 * Límites propuestos. Pensados con holgura para el trabajo normal de un
 * asesor (una conversación activa llega a ~10-15 mensajes por minuto en
 * ráfagas y a unos 300 por hora) y bajos para un bucle o una cuenta robada.
 */
export const RATE_RULES = {
  /** Enviar mensaje (POST /api/v1/messages): por usuario. */
  messageSend: rule("message_send", [
    { limit: 40, seconds: MINUTE },
    { limit: 600, seconds: HOUR },
  ]),
  /** Enviar plantilla de WhatsApp: son las que más cuestan a la reputación del número. */
  templateSend: rule("template_send", [
    { limit: 20, seconds: MINUTE },
    { limit: 300, seconds: HOUR },
  ]),
  /** Pedir enlace de subida (chat o respuesta guardada): un mensaje lleva hasta 5 archivos. */
  uploadUrl: rule("upload_url", [
    { limit: 30, seconds: MINUTE },
    { limit: 300, seconds: HOUR },
  ]),
  /** Leer o listar contactos por la API (páginas de hasta 100): tope contra el vaciado de la lista. */
  contactsRead: rule("contacts_read", [
    { limit: 60, seconds: MINUTE },
    { limit: 1200, seconds: HOUR },
  ]),
  /** "¿Olvidaste tu contraseña?" por correo (cada pedido invalida el enlace anterior). */
  passwordResetEmail: rule("pwd_reset_email", [{ limit: 5, seconds: HOUR }]),
  /** "¿Olvidaste tu contraseña?" por dirección IP (acción pública). */
  passwordResetIp: rule("pwd_reset_ip", [
    { limit: 10, seconds: MINUTE },
    { limit: 30, seconds: HOUR },
  ]),
  /** Iniciar "Ver como" (solo Dueños). */
  viewAsStart: rule("view_as_start", [
    { limit: 5, seconds: MINUTE },
    { limit: 30, seconds: HOUR },
  ]),
  /** Lanzar una difusión. */
  broadcastSend: rule("broadcast_send", [
    { limit: 3, seconds: MINUTE },
    { limit: 20, seconds: HOUR },
  ]),
  /** Empezar una importación de contactos. */
  importStart: rule("import_start", [
    { limit: 3, seconds: MINUTE },
    { limit: 20, seconds: HOUR },
  ]),
} as const satisfies Record<string, RateRule>;

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Cualquier cliente con `rpc` (el de servicio de Supabase o uno falso en pruebas). */
export interface RateLimitClient {
  rpc: unknown;
}

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type RpcFn = (name: string, args: Record<string, unknown>) => RpcResult;

/** Clave del contador de una ventana. El `subject` es un id o un hash, nunca un correo en claro. */
export function bucketKey(rateRule: RateRule, window: RateWindow, subject: string): string {
  return `${rateRule.name}:${window.seconds}:${subject}`.slice(0, 200);
}

/** Mezcla corta y estable para guardar correos o IP sin dejarlos en claro. */
export function hashSubject(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/** Dirección IP de quien llama, según las cabeceras que pone la plataforma. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : "desconocida";
}

interface WindowOutcome {
  allowed: boolean;
  retryAfterSeconds: number;
}

async function hitWindow(
  client: RateLimitClient,
  rateRule: RateRule,
  window: RateWindow,
  subject: string,
): Promise<WindowOutcome> {
  try {
    const { data, error } = await (client.rpc as RpcFn).call(client, "rate_limit_hit", {
      p_bucket: bucketKey(rateRule, window, subject),
      p_limit: window.limit,
      p_window_seconds: window.seconds,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row !== "object") {
      console.error(`[rate-limit] contador no disponible (${rateRule.name}), se deja pasar:`, error?.message ?? "respuesta vacía");
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const r = row as { allowed?: unknown; retry_after_seconds?: unknown };
    if (typeof r.allowed !== "boolean") {
      console.error(`[rate-limit] respuesta inesperada (${rateRule.name}), se deja pasar`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const retry = Number(r.retry_after_seconds);
    return { allowed: r.allowed, retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : window.seconds };
  } catch (err) {
    console.error(`[rate-limit] contador no disponible (${rateRule.name}), se deja pasar:`, err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Suma una vez al contador de cada ventana de la regla y dice si la petición
 * pasa. Con varias ventanas bloqueadas, el `retryAfterSeconds` es el mayor (la
 * persona debe esperar a que se libere la última).
 */
export async function checkRateLimit(
  client: RateLimitClient,
  rateRule: RateRule,
  subject: string,
): Promise<RateDecision> {
  const outcomes = await Promise.all(rateRule.windows.map((w) => hitWindow(client, rateRule, w, subject)));
  const blocked = outcomes.filter((o) => !o.allowed);
  if (blocked.length === 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(...blocked.map((o) => o.retryAfterSeconds)) };
}

/** Los contadores de ventanas con más de un día ya no sirven: el cron diario los borra. */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Fecha de corte de la poda: se borra todo lo que empezó antes. */
export function rateLimitPruneCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - RATE_LIMIT_RETENTION_MS).toISOString();
}
