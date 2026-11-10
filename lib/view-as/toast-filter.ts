// Un solo aviso en vista: cuando "Solo lectura" bloquea una escritura, el aviso
// genérico de error de esa acción ("No se pudo completar la operación…") se
// descarta. Lógica pura (reloj inyectado) más un pequeño estado de módulo que
// comparten la franja (que detecta el bloqueo) y los avisos (ToastProvider).

/** Un error se descarta si hubo un bloqueo hace menos de esto (o llega justo después). */
export const READ_ONLY_ERROR_WINDOW_MS = 4_000;
/** En vista, los avisos de error esperan esto para saber si fueron causados por un bloqueo. */
export const READ_ONLY_ERROR_DEFER_MS = 1_000;

export function shouldSuppressErrorToast(state: { viewActive: boolean; blockedAt: number | null }, now: number): boolean {
  if (!state.viewActive || state.blockedAt === null) return false;
  return Math.abs(now - state.blockedAt) <= READ_ONLY_ERROR_WINDOW_MS;
}

let viewActive = false;
let blockedAt: number | null = null;

export function setToastViewActive(active: boolean): void {
  // El bloqueo no se borra aquí: la franja re-arma su efecto cuando la página se refresca.
  viewActive = active;
}

export function markReadOnlyBlock(now: number = Date.now()): void {
  blockedAt = now;
}

export function isToastViewActive(): boolean {
  return viewActive;
}

export function shouldSuppressErrorToastNow(now: number = Date.now()): boolean {
  return shouldSuppressErrorToast({ viewActive, blockedAt }, now);
}

/** Solo para pruebas. */
export function resetToastFilter(): void {
  viewActive = false;
  blockedAt = null;
}
