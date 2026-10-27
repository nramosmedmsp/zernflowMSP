// Correcciones seguras de español para la revisión al enviar (aprobadas por el
// dueño, docs/PLAN-BANDEJA-CHAT.md). Solo palabras que siempre llevan tilde o
// abreviaturas sin otra lectura: como/cómo, esta/está, mas/más, si/sí, tu/tú,
// el/él y solo dependen del contexto y nunca se tocan.

/** Palabras que siempre llevan tilde (en minúsculas, sin tilde → con tilde). */
export const ALWAYS_ACCENTED: Readonly<Record<string, string>> = {
  asi: "así",
  tambien: "también",
  ademas: "además",
  despues: "después",
  aqui: "aquí",
  ahi: "ahí",
  dia: "día",
  dias: "días",
  telefono: "teléfono",
  numero: "número",
  codigo: "código",
  envios: "envíos",
  proteina: "proteína",
  proteinas: "proteínas",
  garantia: "garantía",
  metodo: "método",
  credito: "crédito",
};

/** "envio" solo es "envío" después de estas palabras (si no, puede ser "envió"). */
export const ENVIO_AFTER: ReadonlySet<string> = new Set(["el", "su", "tu", "mi", "del", "un", "de"]);

/** Abreviaturas de chat (en minúsculas). */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  q: "que",
  xq: "porque",
  pq: "porque",
  tb: "también",
  tmb: "también",
};

/** Palabras con las que suele empezar un saludo antes de la pregunta: "Hola Ana, ¿cómo estás?". */
export const GREETING_STARTS: ReadonlySet<string> = new Set([
  "hola",
  "buenas",
  "buenos",
  "buen",
  "gracias",
  "ok",
  "oye",
  "disculpa",
  "perdon",
  "perdón",
  "listo",
  "claro",
  "genial",
  "perfecto",
  "bueno",
  "ya",
  "entonces",
]);
