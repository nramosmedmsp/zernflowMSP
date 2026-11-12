// Dos personas moviendo la misma gestión a la vez (CONF-11): el servidor solo
// aplica el cambio si la gestión sigue como la persona la vio; si no, devuelve
// este mensaje y la pantalla se recarga sola para mostrar cómo quedó.

export const CASE_CHANGED_MESSAGE =
  "Otra persona acaba de cambiar esta gestión. Actualizamos la pantalla: revisa cómo quedó y vuelve a intentarlo si hace falta.";

export function isCaseConflict(message: string | null | undefined): boolean {
  return message === CASE_CHANGED_MESSAGE;
}
