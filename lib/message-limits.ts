// Largo máximo de lo que se escribe en el chat (PAN-06). Se usa en la caja de
// mensaje (contador) y en el servidor (misma validación).
//
// Máximos por canal (no vienen en el SDK de Zernio, que solo documenta el de los
// botones de 640 caracteres; son los de cada plataforma):
//   WhatsApp   4 096 caracteres (cuerpo de texto, API de Meta)
//   Instagram  1 000 BYTES en UTF-8 (mensajes directos, API de Meta): con tildes
//              o emojis caben menos letras
//   Facebook   2 000 caracteres (Messenger)
//   Telegram   4 096 caracteres
//   X / Reddit 10 000 caracteres
//   Bluesky    1 000 caracteres
// Cualquier otro canal: tope conservador de 1 000 caracteres.

import type { Platform } from "@/lib/types/database";

export type LimitUnit = "caracteres" | "bytes";

export interface MessageLimit {
  max: number;
  unit: LimitUnit;
}

const LIMITS: Record<string, MessageLimit> = {
  whatsapp: { max: 4096, unit: "caracteres" },
  instagram: { max: 1000, unit: "bytes" },
  facebook: { max: 2000, unit: "caracteres" },
  telegram: { max: 4096, unit: "caracteres" },
  twitter: { max: 10_000, unit: "caracteres" },
  reddit: { max: 10_000, unit: "caracteres" },
  bluesky: { max: 1000, unit: "caracteres" },
};

export const DEFAULT_MESSAGE_LIMIT: MessageLimit = { max: 1000, unit: "caracteres" };
/** Notas internas: no salen al cliente; tope propio. */
export const NOTE_MAX_CHARS = 4000;
/** El contador aparece al llegar a esta parte del límite. */
export const COUNTER_SHOW_RATIO = 0.8;

export function messageLimitFor(platform: Platform | string | null | undefined): MessageLimit {
  return (platform && LIMITS[platform]) || DEFAULT_MESSAGE_LIMIT;
}

const encoder = new TextEncoder();

/** Cuánto ocupa el texto en la unidad del límite (caracteres reales, no unidades de UTF-16). */
export function measureText(text: string, unit: LimitUnit): number {
  return unit === "bytes" ? encoder.encode(text).length : Array.from(text).length;
}

export interface LengthCheck {
  ok: boolean;
  used: number;
  max: number;
  unit: LimitUnit;
  /** Cuánto se pasa (0 si cabe). */
  over: number;
  /** Mostrar el contador (cerca del límite o pasado). */
  showCounter: boolean;
}

export function checkLength(text: string, limit: MessageLimit): LengthCheck {
  const used = measureText(text, limit.unit);
  return {
    ok: used <= limit.max,
    used,
    max: limit.max,
    unit: limit.unit,
    over: Math.max(0, used - limit.max),
    showCounter: used >= limit.max * COUNTER_SHOW_RATIO,
  };
}

export function checkMessage(text: string, platform: Platform | string | null | undefined): LengthCheck {
  return checkLength(text, messageLimitFor(platform));
}

export function checkNote(text: string): LengthCheck {
  return checkLength(text, { max: NOTE_MAX_CHARS, unit: "caracteres" });
}

/** Texto del contador: "3 900 / 4 096 caracteres" o, si se pasa, cuánto sobra. */
export function counterLabel(c: LengthCheck): string {
  const fmt = (n: number) => n.toLocaleString("es-PE");
  if (!c.ok) return `Te pasas por ${fmt(c.over)} ${c.unit}. Acorta el mensaje para enviarlo.`;
  return `${fmt(c.used)} / ${fmt(c.max)} ${c.unit}`;
}

/** Mensaje de error del servidor. */
export function tooLongError(platform: Platform | string | null | undefined, c: LengthCheck): string {
  const where = platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : "este canal";
  return `El mensaje es demasiado largo para ${where}: máximo ${c.max.toLocaleString("es-PE")} ${c.unit} y tiene ${c.used.toLocaleString("es-PE")}.`;
}
