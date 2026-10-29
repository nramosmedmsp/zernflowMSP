// Avisos de mensaje nuevo en la bandeja (etapa D): número en la pestaña,
// sonido y notificación de Windows. Cada asesor elige en su equipo; por
// defecto solo el número en la pestaña, para sus chats.

export type AlertScope = "mine" | "mine_and_queue" | "all";

export interface AlertSettings {
  /** "(3) Bandeja" en la pestaña del navegador. */
  tabCount: boolean;
  sound: boolean;
  /** Notificación del sistema, solo con la pestaña en segundo plano. */
  desktop: boolean;
  scope: AlertScope;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = { tabCount: true, sound: false, desktop: false, scope: "mine" };

export const ALERT_SCOPE_LABELS: Record<AlertScope, string> = {
  mine: "Mis chats",
  mine_and_queue: "Mis chats y los sin asignar",
  all: "Todos los chats que veo",
};

/** Opciones de «Avisarme de» que tienen sentido para esta persona (un asesor sin cola visible solo ve sus chats). */
export function alertScopesFor(who: { isAdmin: boolean; supervisedTeamIds: readonly string[]; agentSeesQueue: boolean }): AlertScope[] {
  if (who.isAdmin || who.supervisedTeamIds.length > 0) return ["mine", "mine_and_queue", "all"];
  return who.agentSeesQueue ? ["mine", "mine_and_queue"] : ["mine"];
}

const SCOPES = new Set<AlertScope>(["mine", "mine_and_queue", "all"]);

export function alertSettingsKey(userId: string): string {
  return `zf:inbox-alerts:${userId}`;
}

/** Lee la configuración guardada; cualquier dato raro vuelve al valor por defecto. */
export function parseAlertSettings(raw: string | null | undefined): AlertSettings {
  if (!raw) return { ...DEFAULT_ALERT_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof AlertSettings, unknown>>;
    return {
      tabCount: typeof v.tabCount === "boolean" ? v.tabCount : DEFAULT_ALERT_SETTINGS.tabCount,
      sound: typeof v.sound === "boolean" ? v.sound : DEFAULT_ALERT_SETTINGS.sound,
      desktop: typeof v.desktop === "boolean" ? v.desktop : DEFAULT_ALERT_SETTINGS.desktop,
      scope: SCOPES.has(v.scope as AlertScope) ? (v.scope as AlertScope) : DEFAULT_ALERT_SETTINGS.scope,
    };
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

interface AlertCase {
  assignee_id: string | null;
  status: string;
}

/** ¿Este chat entra en los avisos? Según sus gestiones abiertas o programadas. */
export function inAlertScope(cases: readonly AlertCase[] | undefined, userId: string, scope: AlertScope): boolean {
  if (scope === "all") return true;
  const active = (cases ?? []).filter((c) => c.status === "open" || c.status === "scheduled");
  if (active.some((c) => c.assignee_id === userId)) return true;
  // Sin asignar: sin gestión todavía o con una gestión sin responsable.
  return scope === "mine_and_queue" && (active.length === 0 || active.some((c) => c.assignee_id === null));
}

interface AlertConversation {
  id: string;
  contact_id: string;
  unread_count: number;
}

/** Foto de los no leídos para comparar con la siguiente actualización. */
export function unreadSnapshot(conversations: readonly AlertConversation[]): Map<string, number> {
  return new Map(conversations.map((c) => [c.id, c.unread_count ?? 0]));
}

/** Chats con mensajes nuevos desde la foto anterior (los no leídos subieron). */
export function newMessageIds(previous: ReadonlyMap<string, number>, conversations: readonly AlertConversation[]): string[] {
  return conversations
    .filter((c) => {
      const before = previous.get(c.id);
      // Un chat que aparece por primera vez con no leídos también es nuevo.
      return (c.unread_count ?? 0) > (before ?? 0) && (before !== undefined || previous.size > 0);
    })
    .map((c) => c.id);
}

/** Cuánto se espera a que llegue la gestión de un chat nuevo antes de descartar su aviso (M-14). */
export const ALERT_RETRY_MS = 15_000;

/**
 * Decide qué chats avisan (M-14). El contador de no leídos sube ANTES de que
 * exista o se reabra la gestión del chat, así que un chat nuevo o que vuelve
 * puede estar "fuera de alcance" en ese instante. Esos chats quedan pendientes
 * unos segundos y se vuelven a evaluar cuando llega su gestión.
 *
 * `pending` es el estado anterior (id del chat → hasta cuándo se espera) y se
 * devuelve el nuevo junto con los chats que deben avisar ahora.
 */
export function evaluateAlerts(input: {
  before: ReadonlyMap<string, number>;
  conversations: readonly (AlertConversation & { id: string })[];
  pending: ReadonlyMap<string, number>;
  casesByContact: ReadonlyMap<string, readonly AlertCase[]>;
  userId: string;
  scope: AlertScope;
  /** Chat abierto en pantalla (no avisa si la pestaña se ve). */
  openId: string | null;
  visible: boolean;
  now: number;
}): { alertIds: string[]; pending: Map<string, number> } {
  const { before, conversations, casesByContact, userId, scope, openId, visible, now } = input;
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const nextPending = new Map<string, number>();
  const alertIds: string[] = [];
  const looking = (id: string) => visible && id === openId;
  const inScope = (c: AlertConversation) => inAlertScope(casesByContact.get(c.contact_id), userId, scope);

  const fresh = new Set(newMessageIds(before, conversations));
  for (const id of fresh) {
    const conv = byId.get(id)!;
    if (looking(id)) continue;
    if (inScope(conv)) alertIds.push(id);
    else nextPending.set(id, now + ALERT_RETRY_MS);
  }

  for (const [id, expiresAt] of input.pending) {
    if (fresh.has(id) || expiresAt <= now) continue;
    const conv = byId.get(id);
    if (!conv || (conv.unread_count ?? 0) === 0) continue;
    if (!inScope(conv)) {
      nextPending.set(id, expiresAt);
      continue;
    }
    if (!looking(id)) alertIds.push(id);
  }
  return { alertIds, pending: nextPending };
}

/** Chats con no leídos dentro del alcance (el número de la pestaña). */
export function unreadChatsInScope(
  conversations: readonly AlertConversation[],
  casesByContact: ReadonlyMap<string, readonly AlertCase[]>,
  userId: string,
  scope: AlertScope,
): number {
  return conversations.filter((c) => (c.unread_count ?? 0) > 0 && inAlertScope(casesByContact.get(c.contact_id), userId, scope)).length;
}

/** "(3) Bandeja" — quita un número anterior; sin no leídos deja el título limpio. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(/^\(\d+\+?\)\s*/, "");
  if (count <= 0) return base;
  return `(${count > 99 ? "99+" : count}) ${base}`;
}
