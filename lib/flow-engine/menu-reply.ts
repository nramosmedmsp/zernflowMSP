// Respuestas a menús: cuando el último mensaje del bot tenía botones o
// respuestas rápidas (incluso los que WhatsApp convirtió en una lista
// numerada por sus límites), el cliente suele contestar con el número de la
// opción ("1", "2.") o escribiendo su texto. Esta parte pura interpreta esa
// respuesta como la opción elegida. La usan el motor real
// (lib/inbound-pipeline.ts), el nodo que envía el mensaje (engine.ts) y el
// laboratorio de conversaciones (lib/flow-lab).
//
// El menú viaja en la sesión del flujo, en la variable `__menu` (JSON): el
// nodo Enviar mensaje la deja puesta (o la quita si su último mensaje no
// tiene opciones) y las variables de la sesión se guardan al llegar a la
// espera de la respuesta.

/** Variable de la sesión donde queda el menú del último mensaje del bot. */
export const MENU_VARIABLE = "__menu";

export interface MenuOption {
  title: string;
  /** Carga que envía el botón al pulsarlo. */
  payload?: string;
  /** Botón con enlace: cuenta en la numeración pero no se puede elegir respondiendo. */
  link?: boolean;
}

export interface Menu {
  /** Cómo llegaría la pulsación: botón (postback) o respuesta rápida. */
  kind: "button" | "quick_reply";
  options: MenuOption[];
}

interface MenuSourceMessage {
  buttons?: Array<{ title: string; type?: string; payload?: string; url?: string }>;
  quickReplies?: Array<{ title: string; payload?: string }>;
  carousel?: unknown;
}

/**
 * Menú de un mensaje del bot (el que se escribió en el nodo, antes de
 * adaptarlo al canal): los botones y, si no hay, las respuestas rápidas, en
 * el mismo orden en que la lista numerada los enumera. Un carrusel no cuenta.
 */
export function menuFromMessage(message: MenuSourceMessage | null | undefined): Menu | null {
  if (!message || message.carousel) return null;
  if (message.buttons?.length) {
    return {
      kind: "button",
      options: message.buttons.map((b) => ({
        title: b.title,
        ...(b.payload ? { payload: b.payload } : {}),
        ...(b.type === "url" || (!b.payload && b.url) ? { link: true } : {}),
      })),
    };
  }
  if (message.quickReplies?.length) {
    return {
      kind: "quick_reply",
      options: message.quickReplies.map((q) => ({ title: q.title, ...(q.payload ? { payload: q.payload } : {}) })),
    };
  }
  return null;
}

/**
 * Deja en las variables de la sesión el menú del último mensaje que envía el
 * nodo (o lo quita si ese mensaje no tiene opciones, o si no se envió nada).
 */
export function recordMenu(variables: Record<string, string>, messages: readonly MenuSourceMessage[] | null): void {
  const menu = messages && messages.length > 0 ? menuFromMessage(messages[messages.length - 1]) : null;
  if (menu) variables[MENU_VARIABLE] = JSON.stringify(menu);
  else delete variables[MENU_VARIABLE];
}

/** Menú guardado en las variables de una sesión (null si no hay o no se entiende). */
export function readMenu(variables: unknown): Menu | null {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return null;
  const raw = (variables as Record<string, unknown>)[MENU_VARIABLE];
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Menu>;
    if ((parsed.kind !== "button" && parsed.kind !== "quick_reply") || !Array.isArray(parsed.options)) return null;
    const options = parsed.options.filter(
      (o): o is MenuOption => !!o && typeof o === "object" && typeof (o as MenuOption).title === "string",
    );
    return options.length > 0 ? { kind: parsed.kind, options } : null;
  } catch {
    return null;
  }
}

/** Minúsculas, sin tildes y con los espacios normalizados. */
export function normalizeReply(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_ONLY = /^(\d{1,3})\s*[.)\-:]?$/;

/**
 * Opción que el texto elige: solo un número ("1", "2.", "3)"), o el texto
 * exacto de una opción sin importar mayúsculas y tildes. Null si no elige
 * ninguna (número fuera de rango, texto distinto, opción con enlace).
 */
export function resolveMenuChoice(text: string | undefined | null, menu: Menu | null): MenuOption | null {
  if (!menu || !text) return null;
  const clean = text.trim();
  if (!clean) return null;
  const numbered = NUMBER_ONLY.exec(clean);
  let chosen: MenuOption | undefined;
  if (numbered) {
    chosen = menu.options[Number(numbered[1]) - 1];
  } else {
    const wanted = normalizeReply(clean);
    chosen = menu.options.find((o) => normalizeReply(o.title) === wanted);
  }
  return chosen && !chosen.link && chosen.title.trim() ? chosen : null;
}

export interface ReplyLike {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  callbackData?: string;
}

export interface MenuReplyResult<T extends ReplyLike> {
  /** El mensaje que retoma la espera (reemplazado si eligió una opción). */
  incoming: T;
  /** La opción interpretada, o null si el mensaje queda como llegó. */
  choice: MenuOption | null;
  /** Lo que escribió el cliente, solo si se reemplazó. */
  original?: string;
}

/**
 * Interpreta la respuesta del cliente contra el menú del último mensaje del
 * bot. Si elige una opción, el texto pasa a ser el título del botón y, si el
 * botón tiene carga, también viaja la carga (como pulsación de botón o de
 * respuesta rápida). Una pulsación real (con carga) no se toca.
 */
export function applyMenuReply<T extends ReplyLike>(incoming: T, menu: Menu | null): MenuReplyResult<T> {
  if (!menu || incoming.postbackPayload || incoming.quickReplyPayload || incoming.callbackData) {
    return { incoming, choice: null };
  }
  const choice = resolveMenuChoice(incoming.text, menu);
  if (!choice) return { incoming, choice: null };
  const replaced: T = { ...incoming, text: choice.title };
  if (choice.payload) {
    if (menu.kind === "button") replaced.postbackPayload = choice.payload;
    else replaced.quickReplyPayload = choice.payload;
  }
  return { incoming: replaced, choice, original: incoming.text };
}

/** Atajo: interpreta la respuesta con el menú guardado en las variables de la sesión. */
export function applyWaitingMenuReply<T extends ReplyLike>(sessionVariables: unknown, incoming: T): MenuReplyResult<T> {
  return applyMenuReply(incoming, readMenu(sessionVariables));
}
