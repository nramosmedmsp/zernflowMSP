// Opciones rápidas de "Posponer" en la cabecera del chat (hora de Lima). Se
// guardan como próximo contacto de la gestión: el chat vuelve en "Para hoy".

import { addDays, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";

export interface PostponeOption {
  key: "hour" | "evening" | "tomorrow" | "three-days" | "monday";
  label: string;
  /** "15:45" o "mié 28 oct · 9:00". */
  detail: string;
  /** Instante ISO. */
  at: string;
}

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

function limaParts(at: Date) {
  const d = new Date(at.getTime() + LIMA_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
}

function clock(at: Date): string {
  const p = limaParts(at);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

function dayLabel(at: Date): string {
  const p = limaParts(at);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}

export function postponeOptions(now: Date): PostponeOption[] {
  const today = limaDateOf(now);
  const { hour, weekday } = limaParts(now);
  const options: PostponeOption[] = [];

  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
  options.push({ key: "hour", label: "En 1 hora", detail: clock(inAnHour), at: inAnHour.toISOString() });

  if (hour < 17) {
    const evening = limaDateTimeIso(today, 18);
    options.push({ key: "evening", label: "Hoy en la tarde", detail: "18:00", at: evening });
  }

  const morning = (date: string) => {
    const at = limaDateTimeIso(date, 9);
    return { at, detail: `${dayLabel(new Date(at))} · 9:00` };
  };
  options.push({ key: "tomorrow", label: "Mañana", ...morning(addDays(today, 1)) });
  options.push({ key: "three-days", label: "En 3 días", ...morning(addDays(today, 3)) });

  // El próximo lunes, si no coincide con mañana ni con "en 3 días".
  const toMonday = ((8 - weekday) % 7) || 7;
  if (toMonday !== 1 && toMonday !== 3) {
    options.push({ key: "monday", label: "El lunes", ...morning(addDays(today, toMonday)) });
  }
  return options;
}
