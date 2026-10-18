// Lógica pura de scripts/datos-prueba.mjs: qué datos de prueba se crean y qué
// ids hay que borrar. Sin red ni lectura de .env, para probarla con vitest
// (scripts/datos-prueba.test.ts).
//
// Todo lo que crea el script queda marcado de tres formas:
//   - nombres con " (Prueba)" (asesores, equipos, canales, contactos,
//     respuestas guardadas y difusión);
//   - correos @prueba.invalid y canales con late_account_id "demo-...";
//   - los ids creados se guardan en workspaces.settings.demo_data.

export const DEMO_SUFFIX = " (Prueba)";
export const DEMO_EMAIL_DOMAIN = "prueba.invalid";
export const DEMO_CHANNEL_PREFIX = "demo-";
export const DEMO_TAG_NAME = "Datos de prueba";
export const DEMO_DATA_KEY = "demo_data";
export const DEMO_DATA_VERSION = 1;

const MIN = 60_000;
const DAY = 1440;

// ── Tiempo ─────────────────────────────────────────────────────────────────

/** ISO de hace `minutes` minutos. */
export function agoIso(now, minutes) {
  return new Date(now.getTime() - minutes * MIN).toISOString();
}

/** ISO de dentro de `minutes` minutos. */
export function inIso(now, minutes) {
  return new Date(now.getTime() + minutes * MIN).toISOString();
}

/** Fecha (YYYY-MM-DD) en hora de Lima (UTC-5, sin horario de verano). */
export function limaDate(iso) {
  return new Date(new Date(iso).getTime() - 5 * 60 * MIN).toISOString().slice(0, 10);
}

/** ISO de las `hour`:00 de Lima, `days` días después de hoy (hora de Lima). */
export function limaAtIso(now, days, hour) {
  const [y, m, d] = limaDate(now.toISOString()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, hour + 5, 0, 0)).toISOString();
}

// ── Asesores, equipos y canales ────────────────────────────────────────────

export const TEAMS = [
  { key: "ventas", name: "Ventas (Prueba)", assignment_mode: "round_robin", wantsDefault: true },
  { key: "atencion", name: "Atención (Prueba)", assignment_mode: "least_load", wantsDefault: false },
];

export const ADVISORS = [
  {
    key: "sofia",
    name: "Sofía Paredes (Prueba)",
    email: `sofia.paredes@${DEMO_EMAIL_DOMAIN}`,
    team: "ventas",
    teamRole: "supervisor",
    availability: "available",
  },
  {
    key: "diego",
    name: "Diego Salazar (Prueba)",
    email: `diego.salazar@${DEMO_EMAIL_DOMAIN}`,
    team: "ventas",
    teamRole: "agent",
    availability: "available",
  },
  {
    key: "marco",
    name: "Marco Huamán (Prueba)",
    email: `marco.huaman@${DEMO_EMAIL_DOMAIN}`,
    team: "atencion",
    teamRole: "agent",
    availability: "available",
  },
  {
    key: "rocio",
    name: "Rocío Vargas (Prueba)",
    email: `rocio.vargas@${DEMO_EMAIL_DOMAIN}`,
    team: "atencion",
    teamRole: "agent",
    availability: "away",
  },
];

export const CHANNELS = [
  {
    key: "wa",
    platform: "whatsapp",
    late_account_id: `${DEMO_CHANNEL_PREFIX}whatsapp-001`,
    display_name: "WhatsApp (Prueba)",
    username: "+51 900 000 000",
  },
  {
    key: "ig",
    platform: "instagram",
    late_account_id: `${DEMO_CHANNEL_PREFIX}instagram-001`,
    display_name: "Instagram (Prueba)",
    username: "muscleshop_prueba",
  },
];

/** Postventa pasa a destino fijo en Atención; el valor anterior se guarda para restaurarlo. */
export const ROUTING_OVERRIDES = [{ caseType: "Postventa", routing: "fixed_team", team: "atencion" }];

// ── Contactos ──────────────────────────────────────────────────────────────

/**
 * type: tipo de contacto final (coherente con las gestiones ganadas).
 * channel: wa (WhatsApp, teléfono como platform_sender_id) o ig (Instagram).
 * keyDateAgo: días desde la última compra (fecha clave); se calcula de las
 * gestiones ganadas, salvo que se indique aquí.
 */
export const CONTACTS = [
  { key: "camila", first: "Camila", last: "Quispe", type: "Prospecto", channel: "wa", email: true, tags: ["Proteína"] },
  { key: "jorge", first: "Jorge", last: "Huamaní", type: "Prospecto", channel: "wa", email: false, tags: ["Creatina"] },
  { key: "valeria", first: "Valeria", last: "Rojas", type: "Cliente", channel: "wa", email: true, tags: ["Proteína"] },
  { key: "renzo", first: "Renzo", last: "Campos", type: "Prospecto", channel: "wa", email: false, tags: ["Pre-entreno"] },
  { key: "andrea", first: "Andrea", last: "Flores", type: "Cliente frecuente", channel: "wa", email: true, tags: ["Proteína", "Creatina"] },
  { key: "luis", first: "Luis", last: "Ccori", type: "Cliente", channel: "wa", email: false, tags: ["Proteína"] },
  { key: "fiorella", first: "Fiorella", last: "Chávez", type: "Cliente", channel: "wa", email: true, tags: ["Creatina"] },
  { key: "marcelo", first: "Marcelo", last: "Vega", type: "Cliente", channel: "wa", email: true, tags: ["Mayorista"] },
  { key: "daniela", first: "Daniela", last: "Torres", type: "Prospecto", channel: "ig", handle: "dani.torres.fit", email: false, tags: [] },
  { key: "kevin", first: "Kevin", last: "Mamani", type: "Prospecto", channel: "ig", handle: "kevin_mamani_gym", email: false, tags: ["Pre-entreno"] },
  { key: "rosa", first: "Rosa", last: "Condori", type: "Prospecto", channel: "wa", email: false, tags: [] },
  { key: "alonso", first: "Alonso", last: "Ramírez", type: "Prospecto", channel: "ig", handle: "alonso.ramirez.pe", email: false, tags: ["Proteína"] },
  { key: "milagros", first: "Milagros", last: "Soto", type: "Cliente", channel: "wa", email: true, tags: ["Pre-entreno", "Creatina"] },
  { key: "cesar", first: "César", last: "Gutiérrez", type: "Cliente", channel: "wa", email: true, tags: ["Proteína"] },
  { key: "patricia", first: "Patricia", last: "Salas", type: "Prospecto", channel: "wa", email: false, tags: [] },
  { key: "bruno", first: "Bruno", last: "Fernández", type: "Cliente", channel: "wa", email: true, tags: ["Creatina"] },
  { key: "xiomara", first: "Xiomara", last: "Paz", type: "Cliente", channel: "wa", email: false, tags: ["Proteína"] },
  { key: "hugo", first: "Hugo", last: "Delgado", type: "Cliente frecuente", channel: "wa", email: true, tags: ["Mayorista", "Proteína"] },
  { key: "karen", first: "Karen", last: "Ñahui", type: "Inactivo", channel: "wa", email: false, tags: [], keyDateAgo: 100 },
  { key: "anthony", first: "Anthony", last: "Zevallos", type: "Cliente", channel: "wa", email: true, tags: ["Mayorista"] },
];

/** Equipo y responsable del contacto (el reparto "al responsable" y "al equipo" los usa). */
export const CONTACT_ASSIGNMENTS = {
  valeria: { team: "ventas", owner: "sofia" },
  andrea: { team: "atencion", owner: "marco" },
  marcelo: { team: "atencion", owner: "rocio" },
  hugo: { team: "ventas", owner: "diego" },
  milagros: { team: "ventas", owner: "sofia" },
  cesar: { team: "ventas", owner: "diego" },
};

export function contactDisplayName(c) {
  return `${c.first} ${c.last}${DEMO_SUFFIX}`;
}

/** Teléfono de prueba: +51 900 000 0NN (el número de la fila, empezando en 1). */
export function contactPhone(index) {
  return `+51900000${String(index + 1).padStart(3, "0")}`;
}

export function contactEmail(c) {
  if (!c.email) return null;
  const clean = (s) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  return `${clean(c.first)}.${clean(c.last)}@${DEMO_EMAIL_DOMAIN}`;
}

/** platform_sender_id del contacto en su canal. */
export function contactSenderId(c, index) {
  if (c.channel === "ig") return `${DEMO_CHANNEL_PREFIX}ig-${c.key}`;
  return contactPhone(index).replace(/\D/g, "");
}

// ── Conversaciones ─────────────────────────────────────────────────────────
// Cada mensaje: [quién, texto, minutos atrás]. "c" = cliente; cualquier otra
// clave es el asesor que respondió. Se ordenan por fecha al construir.

const TEMPLATE_RECOMPRA = (name) =>
  `Hola ${name}, ya casi se te acaba tu suplemento. ¿Quieres que te separemos tu pedido de recompra con tu precio de cliente?`;

export const CONVERSATIONS = [
  {
    contact: "camila",
    messages: [
      ["c", "Hola, buenas tardes", 14],
      ["c", "Quisiera info de la proteína whey, ¿qué marcas tienen?", 12],
    ],
  },
  {
    contact: "jorge",
    messages: [
      ["c", "Hola, ¿cuánto cuesta la proteína whey de 2 libras?", 13400],
      ["diego", "Hola Jorge, buenas. La whey de 2 lb está S/ 179 😊", 13390],
      ["c", "Uf, está caro. En otra tienda la vi en S/ 150", 13300],
      ["diego", "Entiendo. Esa es una marca distinta; la nuestra es original con registro sanitario. Si quieres te armo un combo con shaker", 13290],
      ["c", "Mmm déjame pensarlo, gracias", 13200],
      ["c", "Buenas, ¿cuánto cuesta la creatina monohidratada de 300 g?", 135],
      ["diego", "Hola Jorge, buenas tardes. La creatina de 300 g está S/ 89 y la de 500 g S/ 129 😊", 127],
      ["c", "¿Y tienen stock? Quiero la de 500", 100],
      ["diego", "Sí, tenemos stock. ¿Para dónde sería el envío?", 95],
      ["c", "Para Huancayo. ¿Cuánto sale el envío?", 40],
    ],
  },
  {
    contact: "valeria",
    messages: [
      ["c", "Hola, quiero la proteína de vainilla, ¿tienen?", 14500],
      ["sofia", "Hola Valeria 💪 sí, la whey vainilla de 2 lb está S/ 169", 14490],
      ["c", "Ya pues, la llevo. ¿Cómo pago?", 14450],
      ["sofia", "Puedes pagar por Yape o Plin al 999 000 111 (Muscle Shop) y me mandas la captura", 14440],
      ["c", "Listo, ya yapeé. Envío la captura", 14400],
      ["sofia", "Recibido, gracias Valeria. Sale hoy con Olva 🚚", 14380],
      ["c", "Hola! Quiero comprar de nuevo la proteína vainilla de 2 lb", 305],
      ["sofia", "Hola Valeria, qué gusto. Está S/ 169; con tu precio de clienta te queda en S/ 159", 295],
      ["c", "Ya pues, la llevo. ¿Cómo pago?", 270],
      ["sofia", "Te envío el enlace de pago 👇 https://pago.ejemplo.invalid/p/8f3k2 (también por Yape o Plin)", 265],
      ["c", "Listo, ya pagué por Yape, te mando la captura", 200],
      ["sofia", "Gracias, estoy verificando el pago y te confirmo en unos minutos 🙌", 195],
    ],
  },
  {
    contact: "renzo",
    messages: [
      ["c", "Hola, ¿qué pre-entreno me recomiendas para entrenar en las mañanas?", 2000],
      ["diego", "Hola Renzo, para las mañanas te recomiendo el C4 Original: S/ 139 el pote de 30 servicios 🔥", 1990],
      ["c", "Ok, me interesa. ¿Tienen sabor frutas?", 1950],
      ["diego", "Sí, en Fruit Punch y Frutas. ¿Te armo el pedido?", 1940],
      ["c", "Dale, mándame el enlace de pago", 1880],
      ["diego", "Listo, aquí tu enlace de pago: https://pago.ejemplo.invalid/p/rz41q. Vence hoy a las 8 pm", 1870],
      ["c", "Gracias, mañana te confirmo porque recién cobro", 1800],
      ["diego", "Ya pues Renzo, quedo atento. Si el enlace vence te genero otro 👍", 1790],
    ],
  },
  {
    contact: "andrea",
    messages: [
      ["c", "Hola, quiero 2 potes de creatina, ¿hacen descuento?", 11800],
      ["sofia", "Hola Andrea, por 2 potes de 300 g te dejo S/ 165 en total 💪", 11790],
      ["c", "Perfecto, ¿puedo pagar con Plin?", 11760],
      ["sofia", "Claro, al 999 000 111. Envíame la captura cuando lo hagas", 11750],
      ["c", "Ya está, te mando la captura", 11700],
      ["sofia", "Pago confirmado, gracias Andrea. Tu pedido sale mañana temprano 🚚", 11500],
      ["c", "Buenas, ¿en cuánto tiempo llega mi pedido MS-10391? Hace 3 días que lo pedí", 7400],
      ["marco", "Hola Andrea, ya lo reviso. Está en tránsito con Olva, llega hoy antes de las 6 pm", 7390],
      ["c", "Perfecto, gracias. Ya me llegó 😊", 7200],
      ["c", "Buenas tardes, hice un pedido ayer por la web (#MS-10482) y aún no me llega el correo de seguimiento", 260],
      ["marco", "Hola Andrea, ya reviso tu pedido #MS-10482 😊", 250],
      ["marco", "Lo encontré: salió hoy en la mañana con Olva Courier, código OLV-88341. Te llega en 2 a 3 días a Lima", 240],
      ["c", "Ok gracias. ¿Y si quiero cambiar la dirección?", 185],
      ["marco", "Claro, pásame la nueva dirección y referencia y hago el cambio con el courier", 178],
      ["c", "Av. Los Olivos 345, Dpto 402, Surco. Mismo teléfono", 170],
    ],
  },
  {
    contact: "luis",
    messages: [
      ["c", "Hola, quería el pre-entreno y la proteína de chocolate", 29000],
      ["diego", "Hola Luis, el combo pre-entreno + whey chocolate está S/ 299 🔥", 28990],
      ["c", "Va, lo llevo. Envíame el enlace", 28950],
      ["diego", "Aquí tienes: https://pago.ejemplo.invalid/p/lu77c", 28940],
      ["c", "Pagado!", 28850],
      ["c", "Hola, compré la proteína de chocolate pero me equivoqué, quería vainilla. ¿Se puede cambiar?", 3000],
      ["marco", "Hola Luis, sí se puede cambiar siempre que el pote esté sellado 😊 ¿Lo abriste?", 2980],
      ["c", "No, está sellado, lo recibí hoy", 2960],
      ["marco", "Perfecto. Para el cambio por vainilla me envías una foto del pote sellado y tu número de pedido, y coordinamos el recojo", 2950],
      ["c", "Mañana te mando la foto, estoy fuera de casa", 2900],
      ["marco", "Ya pues Luis, quedo atento a la foto para generar el cambio 👍", 2890],
    ],
  },
  {
    contact: "fiorella",
    messages: [
      ["c", "Hola, me llegó la creatina con el sello roto 😠", 27],
      ["c", "Adjunto foto y mi pedido es #MS-10477", 25],
    ],
  },
  {
    contact: "marcelo",
    messages: [
      ["c", "Buenas, es la segunda vez que me llega incompleto mi pedido. Faltó el shaker que venía de regalo", 4300],
      ["rocio", "Hola Marcelo, lamento mucho lo ocurrido. Ya escalé tu caso con almacén para enviarte el shaker sin costo", 4280],
      ["c", "Ok, pero quiero saber cuándo me lo mandan porque ya es la segunda vez", 2900],
      ["rocio", "Almacén me confirma envío para mañana con Shalom. Te paso el código apenas lo tenga", 2880],
      ["c", "Ya pasó un día y no me dicen nada. Esto es falta de seriedad", 1560],
    ],
  },
  {
    contact: "daniela",
    messages: [
      ["c", "Hola, ¿cuál es el precio de la proteína isolate?", 5800],
      ["sofia", "Hola Daniela, la isolate de 2 lb está S/ 219 😊", 5790],
      ["c", "Gracias, solo quería saber. Saludos", 5760],
      ["c", "Hola! ¿Cuál es el horario de atención de la tienda?", 9],
      ["c", "¿Y puedo recoger mi pedido?", 7],
    ],
  },
  {
    contact: "kevin",
    messages: [
      ["c", "Buenas, ¿tienen BCAA?", 13600],
      ["marco", "Hola Kevin, sí, BCAA en polvo de 30 servicios a S/ 99 💪", 13590],
      ["c", "Ok gracias", 13500],
      ["c", "Buenas, ¿hacen envíos a Piura?", 3],
    ],
  },
  {
    contact: "rosa",
    messages: [
      ["c", "Hola, ¿tienen el mass gainer sabor fresa?", 8800],
      ["diego", "Hola Rosa, por ahora solo vainilla y chocolate. Te aviso apenas llegue fresa 😊", 8790],
      ["c", "Ya pues, avísame", 8700],
      ["c", "Hola buenas noches 👋", 6],
      ["c", "¿Tienen BCAA en polvo? Busco para después del gym", 5],
    ],
  },
  {
    contact: "alonso",
    messages: [
      ["c", "hola, precio del mass gainer de 5 lb?", 19000],
      ["diego", "Hola Alonso, el Mass Gainer de 5 lb está S/ 149. ¿Para qué ciudad sería?", 18990],
      ["c", "Para Cusco, ¿cuánto el envío?", 18900],
      ["diego", "El envío a Cusco por Shalom son S/ 25, llega en 3 días", 18890],
      ["c", "hola, precio del mass gainer de 5 lb?", 1700],
      ["diego", "Hola Alonso, el Mass Gainer de 5 lb está S/ 149. ¿Para qué ciudad sería?", 1690],
      ["c", "Para Cusco, ¿cuánto el envío?", 1620],
    ],
  },
  {
    contact: "milagros",
    messages: [
      ["c", "Hola, quiero pre-entreno y creatina, ¿qué me recomiendan para empezar?", 39000],
      ["sofia", "Hola Milagros, para empezar: C4 Original + creatina de 300 g, combo S/ 215 💪", 38990],
      ["c", "Perfecto, lo llevo. ¿Aceptan Yape?", 38950],
      ["sofia", "Sí, al 999 000 111. Envíame la captura 🙌", 38940],
      ["c", "Gracias, ya recibí mi pedido todo ok 😊", 38800],
      ["bot", { template: "recordatorio_recompra" }, 2900],
    ],
  },
  {
    contact: "cesar",
    messages: [
      ["c", "Hola, ¿tienen whey de 5 lb en chocolate?", 40500],
      ["diego", "Hola César, sí, la whey de 5 lb en chocolate está S/ 329 🔥", 40490],
      ["c", "Va, la llevo", 40450],
      ["diego", "Genial, aquí tu enlace de pago: https://pago.ejemplo.invalid/p/ce52h", 40440],
      ["c", "Pagado, gracias!", 40350],
      ["bot", { template: "recordatorio_recompra" }, 1500],
      ["c", "Hola! Sí, ya me estoy quedando sin proteína", 1200],
      ["diego", "Hola César, perfecto. Tu whey de 5 lb está en S/ 289 con tu precio de cliente. ¿Te la reservo?", 1190],
      ["c", "Sí, ¿aceptan Plin?", 60],
      ["c", "¿Y cuánto demora a Trujillo?", 55],
    ],
  },
  {
    contact: "patricia",
    messages: [["c", "Buenas, ¿tienen stock de la proteína isolate? 🙏", 2700]],
  },
];

// ── Gestiones ──────────────────────────────────────────────────────────────
// Campos:
//   key, contact, type (null = Sin clasificar), stage (nombre), status
//   openedAgo: minutos desde que se abrió
//   closedAgo: minutos desde el cierre (cerradas)
//   scheduledIn: minutos hasta la activación (programadas) / scheduledAgo: ya activadas
//   scheduledAt: { days, hour } hora de Lima (programadas); createdAgo: cuándo se programó
//   assignee, team, origin, priority, category, reason, note
//   reached: última etapa abierta que alcanzó antes de cerrarse (por defecto la 2.ª)
//   nextActionIn / nextActionAgo (minutos) y nextActionNote
//   autoTemplate: se envió la plantilla automática al activarse
//   stamps: { lastInboundAgo, lastOutboundAgo, waitingAgo, firstResponse: [esperaAgo, respuestaAgo] }
//     para las que no salen de la conversación

export const CASES = [
  // ── Abiertas sin clasificar ──
  { key: "sc-rosa", contact: "rosa", type: null, stage: null, status: "open", origin: "inbound", team: "ventas", assignee: null, openedAgo: 7, fromConv: true },
  { key: "sc-alonso", contact: "alonso", type: null, stage: null, status: "open", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 1705, fromConv: true },
  { key: "sc-patricia", contact: "patricia", type: null, stage: null, status: "open", origin: "inbound", team: "atencion", assignee: "marco", openedAgo: 2705, fromConv: true },

  // ── Venta, una en cada etapa abierta ──
  { key: "v-camila", contact: "camila", type: "Venta", stage: "Nuevo interesado", status: "open", origin: "inbound", team: "ventas", assignee: null, openedAgo: 14, fromConv: true },
  { key: "v-jorge", contact: "jorge", type: "Venta", stage: "Asesorando", status: "open", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 135, fromConv: true },
  { key: "v-valeria", contact: "valeria", type: "Venta", stage: "Pedido o enlace de pago enviado", status: "open", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 305, fromConv: true, nextActionIn: 180, nextActionNote: "Confirmar el Yape y coordinar el despacho" },
  { key: "v-renzo", contact: "renzo", type: "Venta", stage: "Esperando pago", status: "open", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 2010, fromConv: true, nextActionAgo: 600, nextActionNote: "Preguntar si ya pagó el enlace" },

  // ── Postventa con categorías ──
  { key: "p-andrea", contact: "andrea", type: "Postventa", stage: "En gestión", status: "open", origin: "inbound", team: "atencion", assignee: "marco", category: "Estado de pedido", openedAgo: 265, fromConv: true },
  { key: "p-luis", contact: "luis", type: "Postventa", stage: "Esperando al cliente", status: "open", origin: "inbound", team: "atencion", assignee: "marco", category: "Cambio o devolución", openedAgo: 3010, fromConv: true, nextActionIn: 120, nextActionNote: "Pedir la foto del pote sellado" },
  { key: "p-fiorella", contact: "fiorella", type: "Postventa", stage: "Nueva", status: "open", origin: "inbound", team: "atencion", assignee: null, category: "Producto dañado", openedAgo: 27, fromConv: true },
  { key: "p-marcelo", contact: "marcelo", type: "Postventa", stage: "Esperando almacén o courier", status: "open", origin: "inbound", team: "atencion", assignee: "rocio", category: "Reclamo", priority: "high", openedAgo: 4350, fromConv: true },

  // ── Consulta ──
  { key: "c-daniela", contact: "daniela", type: "Consulta", stage: "Abierta", status: "open", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 10, fromConv: true },
  { key: "c-kevin", contact: "kevin", type: "Consulta", stage: "Abierta", status: "open", origin: "inbound", team: "ventas", assignee: null, openedAgo: 3, fromConv: true },

  // ── Recompra abierta (plantilla automática ya enviada) ──
  { key: "r-milagros", contact: "milagros", type: "Recompra", stage: "Recordatorio enviado", status: "open", origin: "proactive", team: "ventas", assignee: "sofia", openedAgo: 2900, scheduledAgo: 2900, autoTemplate: true, fromConv: true },
  { key: "r-cesar", contact: "cesar", type: "Recompra", stage: "Interesado", status: "open", origin: "proactive", team: "ventas", assignee: "diego", openedAgo: 1500, scheduledAgo: 1500, autoTemplate: true, fromConv: true },

  // ── Recompras programadas: para hoy y para los próximos días ──
  { key: "rp-bruno", contact: "bruno", type: "Recompra", stage: "Recordatorio enviado", status: "scheduled", origin: "proactive", team: null, assignee: null, scheduledIn: 90, createdAgo: 36000 },
  { key: "rp-karen", contact: "karen", type: "Recompra", stage: "Recordatorio enviado", status: "scheduled", origin: "proactive", team: null, assignee: null, scheduledIn: 150, createdAgo: 43000 },
  { key: "rp-xiomara", contact: "xiomara", type: "Recompra", stage: "Recordatorio enviado", status: "scheduled", origin: "proactive", team: null, assignee: null, scheduledAt: { days: 1, hour: 9 }, createdAgo: 34560 },
  { key: "rp-hugo", contact: "hugo", type: "Recompra", stage: "Recordatorio enviado", status: "scheduled", origin: "proactive", team: null, assignee: null, scheduledAt: { days: 3, hour: 9 }, createdAgo: 15840 },
  { key: "rp-anthony", contact: "anthony", type: "Recompra", stage: "Recordatorio enviado", status: "scheduled", origin: "proactive", team: null, assignee: null, scheduledAt: { days: 6, hour: 9 }, createdAgo: 41760 },

  // ── Cerradas en los últimos 30 días: Venta ganada ──
  { key: "vw-valeria", contact: "valeria", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 14500, closedAgo: 14380, fromConv: true, note: "Pago por Yape confirmado. Pedido enviado con Olva", reached: "Pedido o enlace de pago enviado" },
  { key: "vw-andrea-1", contact: "andrea", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 36500, closedAgo: 36000, note: "Pago por Plin. 2 potes de creatina", reached: "Pedido o enlace de pago enviado", stamps: { firstResponse: [36500, 36490] } },
  { key: "vw-andrea-2", contact: "andrea", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 11800, closedAgo: 11500, fromConv: true, note: "Pago por Plin confirmado", reached: "Pedido o enlace de pago enviado" },
  { key: "vw-luis", contact: "luis", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 29000, closedAgo: 28850, fromConv: true, note: "Combo pre-entreno + whey chocolate", reached: "Pedido o enlace de pago enviado" },
  { key: "vw-fiorella", contact: "fiorella", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 26200, closedAgo: 25920, note: "Pagó con tarjeta por el enlace", reached: "Pedido o enlace de pago enviado", stamps: { firstResponse: [26200, 26185] } },
  { key: "vw-milagros", contact: "milagros", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 39000, closedAgo: 38800, fromConv: true, note: "Combo C4 + creatina. Yape", reached: "Pedido o enlace de pago enviado" },
  { key: "vw-cesar", contact: "cesar", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 40500, closedAgo: 40350, fromConv: true, note: "Whey 5 lb chocolate. Pago por enlace", reached: "Pedido o enlace de pago enviado" },
  { key: "vw-bruno", contact: "bruno", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 36400, closedAgo: 36000, note: "Creatina 500 g + shaker", reached: "Pedido o enlace de pago enviado", stamps: { firstResponse: [36400, 36380] } },
  { key: "vw-xiomara", contact: "xiomara", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 34900, closedAgo: 34560, note: "Whey vainilla 2 lb. Plin", reached: "Esperando pago", stamps: { firstResponse: [34900, 34885] } },
  { key: "vw-hugo-1", contact: "hugo", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 32000, closedAgo: 31680, note: "Compra mayorista: 6 potes de whey. Transferencia", reached: "Esperando pago", stamps: { firstResponse: [32000, 31990] } },
  { key: "vw-hugo-2", contact: "hugo", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 16100, closedAgo: 15840, note: "Reposición de 4 potes. Transferencia", reached: "Pedido o enlace de pago enviado", stamps: { firstResponse: [16100, 16090] } },
  { key: "vw-anthony", contact: "anthony", type: "Venta", stage: "Pagado", status: "won", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 42000, closedAgo: 41760, note: "Mayorista: 3 potes de creatina. Yape", reached: "Pedido o enlace de pago enviado", stamps: { firstResponse: [42000, 41985] } },

  // ── Venta perdida (motivo y nota) ──
  { key: "vl-jorge", contact: "jorge", type: "Venta", stage: "No compró", status: "lost", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 13400, closedAgo: 13200, fromConv: true, reason: "Precio", note: "Encontró la whey más barata en otra tienda", reached: "Asesorando" },
  { key: "vl-rosa", contact: "rosa", type: "Venta", stage: "No compró", status: "lost", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 8800, closedAgo: 8700, fromConv: true, reason: "Sin stock", note: "Quería el mass gainer en fresa, quedó en avisarle", reached: "Asesorando" },
  { key: "vl-alonso", contact: "alonso", type: "Venta", stage: "No compró", status: "lost", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 19000, closedAgo: 18700, fromConv: true, reason: "Dejó de responder", note: "No contestó después del precio del envío a Cusco", reached: "Asesorando" },
  { key: "vl-renzo", contact: "renzo", type: "Venta", stage: "No compró", status: "lost", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 26200, closedAgo: 25900, reason: "Costo o demora del envío", note: "El envío a Iquitos le pareció caro", reached: "Asesorando", stamps: { firstResponse: [26200, 26190] } },
  { key: "vl-camila", contact: "camila", type: "Venta", stage: "No compró", status: "lost", origin: "inbound", team: "ventas", assignee: "diego", openedAgo: 21800, closedAgo: 21600, reason: "Solo consultaba", note: "Preguntó precios de creatina y no volvió a escribir", reached: "Nuevo interesado", stamps: { firstResponse: [21800, 21790] } },

  // ── Postventa resuelta y sin solución ──
  { key: "pr-andrea", contact: "andrea", type: "Postventa", stage: "Resuelta", status: "resolved", origin: "inbound", team: "atencion", assignee: "marco", category: "Estado de pedido", openedAgo: 7400, closedAgo: 7200, fromConv: true, note: "Pedido entregado, cliente conforme", reached: "En gestión" },
  { key: "pr-luis", contact: "luis", type: "Postventa", stage: "Resuelta", status: "resolved", origin: "inbound", team: "atencion", assignee: "marco", category: "Cambio o devolución", openedAgo: 20600, closedAgo: 20160, note: "Cambio de sabor realizado sin costo", reached: "Esperando al cliente", stamps: { firstResponse: [20600, 20585] } },
  { key: "pr-marcelo", contact: "marcelo", type: "Postventa", stage: "Resuelta", status: "resolved", origin: "inbound", team: "atencion", assignee: "rocio", category: "Comprobante", openedAgo: 30500, closedAgo: 30240, note: "Se reenvió la boleta electrónica", reached: "En gestión", stamps: { firstResponse: [30500, 30480] } },
  { key: "pl-fiorella", contact: "fiorella", type: "Postventa", stage: "Sin solución", status: "lost", origin: "inbound", team: "atencion", assignee: "marco", category: "Producto dañado", openedAgo: 23400, closedAgo: 23040, note: "Producto abierto y usado: fuera de garantía", reached: "En gestión", stamps: { firstResponse: [23400, 23380] } },

  // ── Consulta resuelta ──
  { key: "cr-daniela", contact: "daniela", type: "Consulta", stage: "Resuelta", status: "resolved", origin: "inbound", team: "ventas", assignee: "sofia", openedAgo: 5800, closedAgo: 5760, fromConv: true, note: "Consultó el precio de la isolate", reached: "Abierta" },
  { key: "cr-kevin", contact: "kevin", type: "Consulta", stage: "Resuelta", status: "resolved", origin: "inbound", team: "ventas", assignee: "marco", openedAgo: 13600, closedAgo: 13500, fromConv: true, note: "Consultó el precio del BCAA", reached: "Abierta" },

  // ── Recompra ganada y perdida ──
  { key: "rw-marcelo", contact: "marcelo", type: "Recompra", stage: "Compró", status: "won", origin: "proactive", team: "ventas", assignee: "sofia", openedAgo: 25200, closedAgo: 24500, scheduledAgo: 25200, autoTemplate: true, note: "Recompró 2 potes de whey por Yape", reached: "Interesado", stamps: { firstResponse: [24900, 24890] } },
  { key: "rl-karen", contact: "karen", type: "Recompra", stage: "No compró", status: "lost", origin: "proactive", team: "ventas", assignee: "diego", openedAgo: 18000, closedAgo: 17280, scheduledAgo: 18000, autoTemplate: true, reason: "Precio", note: "Dice que por ahora no tiene presupuesto", reached: "Interesado", stamps: { firstResponse: [17900, 17880] } },
];

// ── Notas internas, notificaciones, respuestas guardadas y difusión ────────
// `{owner}` se reemplaza por el nombre del dueño; `{ana}`-style por el nombre
// del asesor con esa clave.

export const NOTES = [
  { case: "p-marcelo", author: "owner", ago: 1200, mentions: ["rocio"], body: "@{rocio} por favor confirmar con almacén el envío del shaker hoy mismo. Es la segunda vez que le falla el pedido." },
  { case: "v-jorge", author: "diego", ago: 100, mentions: ["sofia"], body: "Es de Huancayo. Cotizar envío con Shalom. @{sofia} ¿podemos darle descuento si lleva 2 potes?" },
  { case: "p-andrea", author: "marco", ago: 175, mentions: [], body: "Pidió cambio de dirección a Surco. Confirmar con Olva antes de las 6 pm." },
  { case: "sc-alonso", author: "owner", ago: 90, mentions: ["diego"], body: "@{diego} lleva más de 24 h sin respuesta, por favor retomar hoy." },
  { case: "v-renzo", author: "diego", ago: 1750, mentions: [], body: "Dice que paga mañana cuando cobre. Volver a escribirle." },
  { case: "v-valeria", author: "sofia", ago: 190, mentions: ["owner"], body: "@{owner} la clienta pide boleta con RUC, ¿emitimos factura?" },
  { case: "r-cesar", author: "diego", ago: 58, mentions: [], body: "Quiere pagar con Plin; enviarle el número y confirmar el costo a Trujillo." },
];

export const NOTIFICATIONS = [
  { type: "mention", case: "v-valeria", ago: 190, read: false, title: "Te mencionaron en {contact}", body: "@{owner} la clienta pide boleta con RUC, ¿emitimos factura?" },
  { type: "case_unassigned", case: "p-fiorella", ago: 25, read: false, title: "Gestión sin asignar: {contact}", body: "Postventa: nadie tomó la gestión todavía." },
  { type: "wait_exceeded", case: "sc-alonso", ago: 60, read: false, title: "Espera excedida: {contact}", body: "Sin clasificar: lleva más de 24 horas esperando respuesta." },
  { type: "next_action_due", case: "v-renzo", ago: 590, read: true, title: "Próximo contacto vencido: {contact}", body: "Venta: Preguntar si ya pagó el enlace" },
  { type: "case_activated", case: "r-milagros", ago: 2900, read: true, title: "Recompra para hoy: {contact}", body: "Recompra" },
];

export const SAVED_REPLIES = [
  { scope: "workspace", title: "Precios de proteínas", shortcut: "precios", body: "Hola {nombre}, estos son nuestros precios vigentes:\n- Whey Protein 2 lb: S/ 169\n- Whey Protein 5 lb: S/ 329\n- Isolate 2 lb: S/ 219\nTodos originales, con registro sanitario. ¿Cuál te interesa?" },
  { scope: "workspace", title: "Envíos a Lima y provincias", shortcut: "envios", body: "Hola {nombre}, el envío a Lima cuesta S/ 10 y llega en 24 a 48 horas. A provincias enviamos por Olva o Shalom: de S/ 18 a S/ 30 según destino, en 2 a 4 días. Pedidos desde S/ 250 tienen envío gratis a Lima." },
  { scope: "workspace", title: "Medios de pago", shortcut: "pagos", body: "Hola {nombre}, puedes pagar por Yape o Plin al 999 000 111 (a nombre de {empresa}), con tarjeta desde nuestro enlace de pago o por transferencia. Envíame la captura cuando lo hagas y confirmamos tu pedido." },
  { scope: "workspace", title: "Horarios de atención", shortcut: "horarios", body: "Hola {nombre}, atendemos de lunes a sábado de 9:00 a 19:00. Fuera de ese horario déjanos tu mensaje y te respondemos apenas abramos. — {asesor}, {empresa}" },
  { scope: "workspace", title: "Cambios y devoluciones", shortcut: "cambios", body: "Hola {nombre}, aceptamos cambios hasta 7 días después de recibir el pedido, siempre que el producto esté sellado. Envíame una foto del pote y tu número de pedido y coordinamos el recojo." },
  { scope: "personal", title: "Agradecimiento por la compra", shortcut: "gracias", body: "¡Gracias por tu compra, {nombre}! 💪 Cualquier duda con tu suplemento escríbeme. — {asesor}" },
  { scope: "personal", title: "Recompra amable", shortcut: "recompra", body: "Hola {nombre}, ¿cómo vas con tu suplemento? Si ya se está acabando, te separo tu pedido con tu precio de cliente. — {asesor}" },
];

export const BROADCAST = {
  name: "Recompra de proteína (Prueba)",
  status: "draft",
  message_content: {
    kind: "template",
    template_name: "recordatorio_recompra",
    language: "es",
    params: ["{nombre}"],
  },
};

// ── Construcción de conversaciones ─────────────────────────────────────────

/** Primeros 100 puntos de código (igual que lib/message-preview.ts). */
export function previewOf(text) {
  return Array.from(text ?? "").slice(0, 100).join("");
}

/**
 * Mensajes de una conversación, ordenados por fecha, y sus sellos.
 * `advisorId(key)` resuelve la clave del asesor; "bot" y las plantillas salen
 * sin autor (las plantillas automáticas las envía el motor).
 */
export function buildConversation(spec, { now, advisorId, contactName }) {
  const first = String(contactName ?? "").split(" ")[0];
  const raw = spec.messages
    .map(([from, content, ago], index) => ({ from, content, ago, index }))
    .sort((a, b) => b.ago - a.ago || a.index - b.index);

  const messages = raw.map((m, i) => {
    const inbound = m.from === "c";
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content?.template === "recordatorio_recompra"
          ? TEMPLATE_RECOMPRA(first)
          : String(m.content?.template ?? "");
    return {
      direction: inbound ? "inbound" : "outbound",
      text,
      created_at: agoIso(now, m.ago),
      sent_by_user_id: inbound || m.from === "bot" ? null : advisorId(m.from),
      platform_message_id: `demo-${spec.contact}-${i + 1}`,
      status: "sent",
      by: m.from,
    };
  });

  const last = messages[messages.length - 1] ?? null;
  let unread = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i].direction === "inbound"; i--) unread++;

  return {
    messages,
    last_message_at: last?.created_at ?? null,
    last_message_preview: last ? previewOf(last.text) : null,
    unread_count: unread,
    // El bot se pausa cuando una persona respondió.
    hasHumanReply: messages.some((m) => m.direction === "outbound" && m.sent_by_user_id),
  };
}

/** Sellos de una gestión a partir de los mensajes de su ventana de tiempo. */
export function deriveCaseStamps(messages, { openedAt, closedAt, now }) {
  const from = new Date(openedAt).getTime();
  const to = closedAt ? new Date(closedAt).getTime() : now.getTime();
  const inWindow = messages.filter((m) => {
    const t = new Date(m.created_at).getTime();
    return t >= from - MIN && t <= to + MIN;
  });
  const inbound = inWindow.filter((m) => m.direction === "inbound");
  const outbound = inWindow.filter((m) => m.direction === "outbound");
  const last = inWindow[inWindow.length - 1] ?? null;

  // La espera empieza con el primer mensaje del cliente del último tramo sin respuesta.
  let waitingSince = null;
  if (!closedAt && last && last.direction === "inbound") {
    for (let i = inWindow.length - 1; i >= 0 && inWindow[i].direction === "inbound"; i--) {
      waitingSince = inWindow[i].created_at;
    }
  }

  // Primera respuesta humana: la primera salida de una persona después del primer mensaje del cliente.
  let firstResponse = null;
  const firstInbound = inbound[0] ?? null;
  if (firstInbound) {
    const reply = outbound.find(
      (m) => m.sent_by_user_id && new Date(m.created_at) > new Date(firstInbound.created_at),
    );
    if (reply) firstResponse = { waitStart: firstInbound.created_at, at: reply.created_at };
  }

  return {
    lastInboundAt: inbound.length ? inbound[inbound.length - 1].created_at : null,
    lastOutboundAt: outbound.length ? outbound[outbound.length - 1].created_at : null,
    waitingSince,
    firstResponse,
  };
}

// ── Construcción de gestiones y su registro ────────────────────────────────

const TERMINAL_KIND = { won: "won", lost: "lost", resolved: "resolved" };

/**
 * Fila de `cases` y filas de `activity` de una gestión.
 * ctx: { workspaceId, now, ids, conversation (resultado de buildConversation o null),
 *        ownerId }
 * ids: { contact(key), type(name), stage(type, name), openStages(type) → nombres en orden,
 *        category(type, name), reason(type, name), advisor(key), team(key),
 *        contactType(name), conversation(contactKey) }
 */
export function buildCase(spec, ctx) {
  const { now, ids } = ctx;
  const contactId = ids.contact(spec.contact);
  const scheduled = spec.status === "scheduled";
  const closed = !!TERMINAL_KIND[spec.status];

  const openedAt = scheduled
    ? null
    : agoIso(now, spec.openedAgo);
  const closedAt = closed ? agoIso(now, spec.closedAgo) : null;

  let scheduledFor = null;
  if (scheduled) {
    scheduledFor = spec.scheduledAt
      ? limaAtIso(now, spec.scheduledAt.days, spec.scheduledAt.hour)
      : inIso(now, spec.scheduledIn);
  } else if (spec.scheduledAgo != null) {
    scheduledFor = agoIso(now, spec.scheduledAgo);
  }
  const createdAt = scheduled ? agoIso(now, spec.createdAgo ?? 60) : (scheduledFor && spec.origin === "proactive" ? scheduledFor : openedAt);

  const messages = ctx.conversation?.messages ?? [];
  let lastInboundAt = null;
  let lastOutboundAt = null;
  let waitingSince = null;
  let firstResponse = null;
  if (!scheduled) {
    if (spec.fromConv && ctx.conversation) {
      const d = deriveCaseStamps(messages, { openedAt, closedAt, now });
      lastInboundAt = d.lastInboundAt;
      lastOutboundAt = d.lastOutboundAt;
      waitingSince = d.waitingSince;
      firstResponse = d.firstResponse;
    } else if (spec.stamps?.firstResponse) {
      const [waitAgo, respAgo] = spec.stamps.firstResponse;
      firstResponse = { waitStart: agoIso(now, waitAgo), at: agoIso(now, respAgo) };
      lastInboundAt = firstResponse.waitStart;
      lastOutboundAt = closedAt ?? firstResponse.at;
    }
  }

  const typeName = spec.type;
  const caseTypeId = typeName ? ids.type(typeName) : null;
  const stageId = typeName && spec.stage ? ids.stage(typeName, spec.stage) : null;
  const categoryId = typeName && spec.category ? ids.category(typeName, spec.category) : null;
  const reasonId = typeName && spec.reason ? ids.reason(typeName, spec.reason) : null;
  const assigneeId = spec.assignee ? ids.advisor(spec.assignee) : null;
  const teamId = spec.team ? ids.team(spec.team) : null;
  const assignedAt = assigneeId ? new Date((openedAt ? new Date(openedAt).getTime() : now.getTime()) + MIN).toISOString() : null;

  const nextActionAt =
    spec.nextActionIn != null ? inIso(now, spec.nextActionIn) : spec.nextActionAgo != null ? agoIso(now, spec.nextActionAgo) : null;

  const row = {
    workspace_id: ctx.workspaceId,
    contact_id: contactId,
    case_type_id: caseTypeId,
    stage_id: stageId,
    category_id: categoryId,
    status: spec.status,
    team_id: teamId,
    assignee_id: assigneeId,
    assigned_at: assignedAt,
    origin: spec.origin,
    scheduled_for: scheduledFor,
    opened_at: openedAt,
    last_inbound_at: lastInboundAt,
    last_outbound_at: lastOutboundAt,
    waiting_since: waitingSince,
    first_response_at: firstResponse?.at ?? null,
    next_action_at: nextActionAt,
    next_action_note: nextActionAt ? (spec.nextActionNote ?? null) : null,
    closed_at: closedAt,
    closed_by: closed ? (assigneeId ?? ctx.ownerId ?? null) : null,
    outcome_reason_id: reasonId,
    outcome_note: closed ? (spec.note ?? null) : null,
    priority: spec.priority ?? "normal",
    auto_template_sent_at: spec.autoTemplate ? (openedAt ?? null) : null,
    created_at: createdAt,
    updated_at: closedAt ?? waitingSince ?? lastOutboundAt ?? openedAt ?? createdAt,
  };

  const activities = caseActivities(spec, row, { ...ctx, firstResponse, openedAt, closedAt, scheduledFor, nextActionAt });
  return { row, activities };
}

function plusMin(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * MIN).toISOString();
}

/** Filas de `activity` (sin case_id: lo pone el script al conocer el id de la gestión). */
export function caseActivities(spec, row, ctx) {
  const { ids, firstResponse, openedAt, closedAt, scheduledFor, nextActionAt } = ctx;
  const out = [];
  const base = { workspace_id: ctx.workspaceId, contact_id: row.contact_id };
  const conversationId = ctx.conversationId ?? null;
  const add = (type, created_at, extra = {}) => out.push({ ...base, conversation_id: null, type, created_at, actor_id: null, from_value: null, to_value: null, meta: {}, ...extra });

  const typeId = row.case_type_id;
  const assignVia = spec.team === "atencion" ? "least_load" : "round_robin";

  if (row.status === "scheduled") {
    add("case_scheduled", row.created_at, {
      to_value: scheduledFor,
      actor_id: null,
      meta: { origin: "proactive", reason: "rule", case_type_id: typeId },
    });
    return out;
  }

  // Apertura
  if (spec.origin === "proactive") {
    add("case_scheduled", plusMin(row.created_at, -60), {
      to_value: scheduledFor,
      meta: { origin: "proactive", reason: "rule", case_type_id: typeId },
    });
    add("case_activated", openedAt, { to_value: typeId, meta: { origin: "proactive" } });
    if (spec.autoTemplate) {
      add("auto_template_sent", plusMin(openedAt, 1), {
        meta: {
          template_name: "recordatorio_recompra",
          language: "es",
          params: [ctx.contactFirstName ?? ""],
          message_id: null,
        },
      });
    }
  } else {
    add("case_opened", openedAt, {
      conversation_id: conversationId,
      to_value: typeId,
      meta: { origin: spec.origin },
    });
  }

  // Reparto
  if (row.assignee_id) {
    add("assigned", plusMin(openedAt, 1), {
      to_value: row.assignee_id,
      meta: { via: assignVia, team_id: row.team_id },
    });
  }

  // Cambios de etapa: de la primera etapa abierta hasta la actual (o la última antes de cerrar).
  if (typeId && spec.type) {
    const openStages = ids.openStages(spec.type);
    const finalOpen = closedAt ? (spec.reached ?? openStages[Math.min(1, openStages.length - 1)]) : spec.stage;
    const upTo = openStages.indexOf(finalOpen);
    const chain = upTo > 0 ? openStages.slice(0, upTo + 1) : [];
    const spanEnd = closedAt ?? ctx.now.toISOString();
    const span = Math.max(0, new Date(spanEnd).getTime() - new Date(openedAt).getTime());
    for (let i = 1; i < chain.length; i++) {
      const at = new Date(new Date(openedAt).getTime() + (span * i) / (chain.length + 1)).toISOString();
      add("stage_changed", at, {
        actor_id: row.assignee_id,
        from_value: ids.stage(spec.type, chain[i - 1]),
        to_value: ids.stage(spec.type, chain[i]),
      });
    }
  }

  // Primera respuesta
  if (firstResponse) {
    const seconds = Math.max(
      0,
      Math.round((new Date(firstResponse.at).getTime() - new Date(firstResponse.waitStart).getTime()) / 1000),
    );
    add("first_response", firstResponse.at, {
      conversation_id: conversationId,
      actor_id: row.assignee_id,
      meta: { seconds, waiting_since: firstResponse.waitStart },
    });
  }

  // Próximo contacto
  if (nextActionAt) {
    add("next_action_set", plusMin(openedAt, 5), {
      actor_id: row.assignee_id,
      to_value: nextActionAt,
      meta: spec.nextActionNote ? { note: spec.nextActionNote } : {},
    });
  }

  // Cierre y tipo de contacto
  if (closedAt) {
    const reachedStage = ids.stage(spec.type, spec.reached ?? ids.openStages(spec.type)[Math.min(1, ids.openStages(spec.type).length - 1)]);
    add("case_closed", closedAt, {
      actor_id: row.assignee_id,
      from_value: reachedStage,
      to_value: TERMINAL_KIND[spec.status],
      meta: {
        stage_id: row.stage_id,
        outcome_reason_id: row.outcome_reason_id,
        category_id: row.category_id,
        ...(spec.note ? { note: spec.note } : {}),
      },
    });
    if (spec.setsContactType) {
      add("contact_type_changed", plusMin(closedAt, 0.05), {
        from_value: ids.contactType(spec.setsContactType.from),
        to_value: ids.contactType(spec.setsContactType.to),
        meta: { reason: "rule", case_id_hint: spec.key },
      });
    }
  }

  return out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

/**
 * Marca en cada gestión ganada el cambio de tipo de contacto que haría la regla:
 * la primera ganada del contacto lo pasa de Prospecto a Cliente y, desde la
 * segunda, a Cliente frecuente. Devuelve copias de las gestiones.
 */
export function withContactTypeChanges(cases) {
  const wins = new Map();
  const ordered = cases
    .filter((c) => c.status === "won")
    .sort((a, b) => b.closedAgo - a.closedAgo);
  const changes = new Map();
  for (const c of ordered) {
    const n = (wins.get(c.contact) ?? 0) + 1;
    wins.set(c.contact, n);
    if (n === 1) changes.set(c.key, { from: "Prospecto", to: "Cliente" });
    else if (n === 2) changes.set(c.key, { from: "Cliente", to: "Cliente frecuente" });
  }
  return cases.map((c) => (changes.has(c.key) ? { ...c, setsContactType: changes.get(c.key) } : c));
}

/** Fecha clave (última compra) por contacto: la de su última venta o recompra ganada. */
export function keyDatesByContact(cases, now) {
  const out = new Map();
  for (const c of cases) {
    if (c.status !== "won") continue;
    const date = limaDate(agoIso(now, c.closedAgo));
    const prev = out.get(c.contact);
    if (!prev || date > prev) out.set(c.contact, date);
  }
  for (const c of CONTACTS) {
    if (c.keyDateAgo != null) out.set(c.key, limaDate(agoIso(now, c.keyDateAgo * DAY)));
  }
  return out;
}

// ── Contactos ──────────────────────────────────────────────────────────────

export function buildContact(spec, index, ctx) {
  const { now, workspaceId, ids, keyDates, lastInteractionAgo } = ctx;
  const assignment = CONTACT_ASSIGNMENTS[spec.key];
  const isWa = spec.channel === "wa";
  const firstCase = ctx.firstCaseAgo ?? 30 * DAY;
  return {
    workspace_id: workspaceId,
    display_name: contactDisplayName(spec),
    email: contactEmail(spec),
    phone: isWa ? contactPhone(index) : null,
    contact_type_id: ids.contactType(spec.type),
    team_id: assignment ? ids.team(assignment.team) : null,
    owner_id: assignment ? ids.advisor(assignment.owner) : null,
    key_date: keyDates.get(spec.key) ?? null,
    source: { demo: true },
    metadata: { demo: true },
    is_subscribed: true,
    last_interaction_at: agoIso(now, lastInteractionAgo ?? 60),
    created_at: agoIso(now, firstCase + DAY),
  };
}

// ── Marcas y comprobaciones del plan ───────────────────────────────────────

/** Problemas de marcado de los datos fijos (lista vacía = todo marcado). */
export function markerProblems() {
  const problems = [];
  const mustSuffix = (label, value) => {
    if (!value.endsWith(DEMO_SUFFIX)) problems.push(`${label} sin "${DEMO_SUFFIX.trim()}": ${value}`);
  };
  for (const a of ADVISORS) {
    mustSuffix("Asesor", a.name);
    if (!a.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) problems.push(`Correo sin @${DEMO_EMAIL_DOMAIN}: ${a.email}`);
  }
  for (const t of TEAMS) mustSuffix("Equipo", t.name);
  for (const c of CHANNELS) {
    mustSuffix("Canal", c.display_name);
    if (!c.late_account_id.startsWith(DEMO_CHANNEL_PREFIX)) problems.push(`Canal sin prefijo ${DEMO_CHANNEL_PREFIX}: ${c.late_account_id}`);
  }
  CONTACTS.forEach((c) => {
    mustSuffix("Contacto", contactDisplayName(c));
    const email = contactEmail(c);
    if (email && !email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) problems.push(`Correo sin @${DEMO_EMAIL_DOMAIN}: ${email}`);
  });
  for (const r of SAVED_REPLIES) mustSuffix("Respuesta guardada", `${r.title}${DEMO_SUFFIX}`);
  mustSuffix("Difusión", BROADCAST.name);
  return problems;
}

/** Título de una respuesta guardada con su marca. */
export function savedReplyTitle(reply) {
  return `${reply.title}${DEMO_SUFFIX}`;
}

// ── demo_data y borrado ────────────────────────────────────────────────────

/** Ids creados; el script los va agregando y guardando en settings.demo_data. */
export function emptyDemoData(now = new Date()) {
  return {
    version: DEMO_DATA_VERSION,
    status: "loading",
    created_at: now.toISOString(),
    user_ids: [],
    invite_ids: [],
    team_ids: [],
    channel_ids: [],
    contact_ids: [],
    case_ids: [],
    tag_ids: [],
    saved_reply_ids: [],
    broadcast_ids: [],
    notification_ids: [],
    // Lo único que el script cambia fuera de lo marcado, con su valor anterior.
    restore: { case_types: [] },
  };
}

export function hasDemoData(settings) {
  const dd = settings?.[DEMO_DATA_KEY];
  return !!dd && typeof dd === "object";
}

/** settings con demo_data agregado (sin tocar el resto). */
export function withDemoData(settings, demoData) {
  return { ...(settings ?? {}), [DEMO_DATA_KEY]: demoData };
}

/** settings como estaban antes de cargar: sin la clave demo_data. */
export function withoutDemoData(settings) {
  const next = { ...(settings ?? {}) };
  delete next[DEMO_DATA_KEY];
  return next;
}

/**
 * Pasos de borrado en orden (lo que hace `borrar`), a partir de demo_data.
 * Primero lo que cuelga de los contactos y canales, al final los asesores:
 *  1. notificaciones creadas (más las de enlaces a contactos de prueba);
 *  2. difusiones; respuestas guardadas;
 *  3. contactos (cascada: conversaciones, mensajes, gestiones, notas,
 *     registro, etiquetas del contacto);
 *  4. canales (cascada: lo que quede de sus conversaciones);
 *  5. restaurar los tipos de gestión modificados;
 *  6. equipos (cascada: team_members);
 *  7. membresías, usuarios de Auth e invitaciones;
 *  8. etiquetas creadas por el script.
 */
export function deletionPlan(demoData) {
  const dd = { ...emptyDemoData(), ...(demoData ?? {}) };
  const step = (kind, table, ids, extra = {}) => ({ kind, table, ids: [...new Set(ids)], ...extra });
  return [
    step("notifications", "notifications", dd.notification_ids, { alsoByContactLink: dd.contact_ids }),
    step("broadcasts", "broadcasts", dd.broadcast_ids),
    step("saved_replies", "saved_replies", dd.saved_reply_ids),
    step("contacts", "contacts", dd.contact_ids),
    step("channels", "channels", dd.channel_ids),
    { kind: "restore_case_types", table: "case_types", ids: dd.restore.case_types.map((c) => c.id), restore: dd.restore.case_types },
    step("teams", "teams", dd.team_ids),
    step("members", "workspace_members", dd.user_ids, { column: "user_id" }),
    step("users", "auth.users", dd.user_ids),
    step("invites", "workspace_invites", dd.invite_ids),
    step("tags", "tags", dd.tag_ids),
  ];
}

/** Total de ids que el plan de borrado toca (sin contar la restauración). */
export function deletionCount(plan) {
  return plan.filter((s) => s.kind !== "restore_case_types").reduce((n, s) => n + s.ids.length, 0);
}

/** Agrupa una lista en trozos (para `in (...)` y lotes). */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Reemplaza {owner} y {clave} (nombre de un asesor) en textos de notas y avisos. */
export function fillNames(text, names) {
  return text.replace(/\{(\w+)\}/g, (match, key) => names[key] ?? match);
}
