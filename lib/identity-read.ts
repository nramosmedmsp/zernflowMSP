// Lecturas de identidad (membresías, espacio): distinguir "la consulta falló" de
// "no hay filas". Un fallo pasajero de la base no debe tratarse como "sin espacio"
// (CONF-02): se reintenta una vez y, si sigue fallando, se lanza para que salga
// la pantalla de error con "Reintentar".

export class IdentityReadError extends Error {
  constructor(source: string, cause: unknown) {
    const detail = cause && typeof cause === "object" && "message" in cause ? String((cause as { message: unknown }).message) : String(cause);
    super(`No se pudo leer ${source}: ${detail}`);
    this.name = "IdentityReadError";
  }
}

/** Mensaje para respuestas JSON (503) cuando no se pudo verificar la membresía. */
export const IDENTITY_UNAVAILABLE_MESSAGE =
  "No se pudo verificar tu espacio de trabajo por un problema pasajero. Inténtalo de nuevo en unos segundos.";

/** Ejecuta la lectura y, si devuelve `error`, la repite una vez tras una pausa corta. */
export async function readOnceMore<T extends { error: unknown }>(
  read: () => PromiseLike<T> | T,
  pauseMs = 150,
): Promise<T> {
  let result: T;
  try {
    result = await read();
  } catch (e) {
    result = { error: e } as T;
  }
  if (!result.error) return result;
  await new Promise((r) => setTimeout(r, pauseMs));
  try {
    return await read();
  } catch (e) {
    return { error: e } as T;
  }
}
