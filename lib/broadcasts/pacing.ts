// Ritmo de envío de las difusiones (CONF-04 / CONF-05). Todo el ritmo vive en
// estas constantes: cambiar el ritmo es cambiar un número aquí.
//
// CÓMO FUNCIONA
//   El cron de trabajos corre cada minuto. En cada pasada, lo urgente va primero
//   (mensajes entrantes, plazos y reclamos de las gestiones, esperas del bot) y
//   las difusiones usan SOLO su porción: como mucho BROADCAST_SENDS_PER_PASS
//   envíos, de a BROADCAST_CONCURRENCY a la vez, y sin empezar ninguno pasado el
//   tiempo límite de la pasada. Lo que no alcanza queda pendiente para la
//   siguiente pasada.
//
// POR QUÉ ESTE RITMO (50 por minuto = 3 000 por hora)
//   - WhatsApp penaliza las ráfagas y la mala calidad (bloqueos y reportes de los
//     clientes), no la velocidad en sí: el tope que de verdad importa es el de
//     contactos únicos por día de cada número (250 o 1 000 al inicio, según el
//     nivel de la cuenta). Un ritmo parejo y moderado, nunca todo de golpe, es lo
//     que recomienda Meta para empezar.
//   - 50 por minuto es unas 20 veces más rápido que las 4 horas que tardaba
//     antes una difusión de 5 000 y deja el resto del minuto libre para las
//     esperas del bot y las tareas de gestiones.
//   - Si la cuenta tiene un tope diario bajo, WhatsApp rechaza el exceso: la
//     difusión se pausa sola tras BROADCAST_AUTO_PAUSE_AFTER_FAILURES fallos
//     seguidos y avisa, en vez de marcar a todos como fallidos.
//
// CUÁNTO TARDA (a BROADCAST_SENDS_PER_PASS por minuto, si Zernio responde normal)
//     1 000 contactos -> 20 minutos
//     5 000 contactos -> 1 hora y 40 minutos
//   Si Zernio responde lento, el tiempo límite de la pasada recorta los envíos de
//   ese minuto y tarda más, pero nunca frena lo demás.

/** Envíos de difusión que se intentan como máximo en cada pasada del cron (una por minuto). */
export const BROADCAST_SENDS_PER_PASS = 50;

/** Envíos a Zernio que van a la vez dentro de una pasada. */
export const BROADCAST_CONCURRENCY = 4;

/**
 * Tiempo, desde que empieza la pasada, pasado el cual ya no se empieza otro envío
 * de difusión (un envío puede tardar hasta 20 s y la función termina a los 60 s).
 */
export const BROADCAST_START_LIMIT_MS = 35_000;

/**
 * Tiempo, desde que empieza la pasada, pasado el cual ya no se empiezan esperas
 * de bot ni otros trabajos: deja al menos 10 s a las difusiones aunque haya una
 * cola de esperas.
 */
export const OTHER_JOBS_START_LIMIT_MS = 25_000;

/** Fallos seguidos (por una causa general, no del contacto) tras los cuales la difusión se pausa sola. */
export const BROADCAST_AUTO_PAUSE_AFTER_FAILURES = 10;

/** Un envío que lleva tanto tiempo "enviándose" quedó cortado a medias: se marca como fallido. */
export const BROADCAST_STALE_SENDING_MS = 5 * 60_000;

/** Cuántas difusiones en curso se miran por pasada (van de la más antigua a la más nueva). */
export const BROADCAST_MAX_PER_PASS = 10;

/** Minutos que tarda en enviarse `pending` mensajes al ritmo de arriba (una pasada por minuto). */
export function estimateBroadcastMinutes(pending: number): number {
  if (!Number.isFinite(pending) || pending <= 0) return 0;
  return Math.ceil(pending / BROADCAST_SENDS_PER_PASS);
}

/** "unos 20 minutos", "1 hora y 40 minutos", "menos de un minuto". */
export function describeBroadcastEta(pending: number): string {
  const minutes = estimateBroadcastMinutes(pending);
  if (minutes <= 0) return "menos de un minuto";
  if (minutes === 1) return "un minuto";
  if (minutes < 60) return `unos ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? "una hora" : `unas ${hours} horas`;
  return `${hours} ${hours === 1 ? "hora" : "horas"} y ${rest} ${rest === 1 ? "minuto" : "minutos"}`;
}
