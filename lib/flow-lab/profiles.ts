// Perfiles iniciales de ejemplo, armados a partir del catálogo por nombre. Lo
// que no se encuentra (un tipo de gestión que el espacio no tiene) queda en
// `notices` y el perfil se arma con lo que haya.

import { addDays, limaDateOf, limaDateTimeIso } from "@/lib/cases/dates";
import { emptyContact, newCaseTemplate } from "./state";
import type { LabCase, LabCaseType, LabCatalog, LabContact, LabMessage, LabProfile } from "./types";

/**
 * Comparación por nombre: sin mayúsculas, tildes ni espacios de más. Igual que normalizeName de
 * lib/business-templates.ts, que no se importa aquí porque arrastra el cliente de servidor de Supabase
 * (este archivo lo usan componentes del navegador).
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function byName<T extends { name: string }>(list: readonly T[], ...names: string[]): T | undefined {
  for (const name of names) {
    const found = list.find((i) => normalizeName(i.name) === normalizeName(name));
    if (found) return found;
  }
  return undefined;
}

function minus(now: number, ms: number): string {
  return new Date(now - ms).toISOString();
}

interface Builder {
  catalog: LabCatalog;
  now: number;
  notices: string[];
  cases: LabCase[];
  messages: LabMessage[];
}

function caseTypeNamed(b: Builder, ...names: string[]): LabCaseType | undefined {
  const found = byName(b.catalog.caseTypes, ...names);
  if (!found) b.notices.push(`El espacio no tiene un tipo de gestión «${names[0]}».`);
  return found;
}

function stageNamed(b: Builder, type: LabCaseType | undefined, ...names: string[]) {
  if (!type) return undefined;
  const found = byName(type.stages, ...names);
  if (!found) b.notices.push(`El tipo «${type.name}» no tiene una etapa «${names[0]}».`);
  return found;
}

function contactTypeNamed(b: Builder, ...names: string[]) {
  const found = byName(b.catalog.contactTypes, ...names);
  if (!found) b.notices.push(`El espacio no tiene un tipo de contacto «${names[0]}».`);
  return found;
}

function addMessage(b: Builder, author: LabMessage["author"], text: string, at: string, extra: Partial<LabMessage> = {}) {
  b.messages.push({ id: `msg-${b.messages.length + 1}`, at, author, kind: "text", text, ...extra });
}

function addCase(b: Builder, patch: Partial<LabCase>): LabCase {
  const row = newCaseTemplate(`case-${b.cases.length + 1}`, patch.openedAt ?? patch.scheduledFor ?? minus(b.now, DAY));
  Object.assign(row, patch);
  b.cases.push(row);
  return row;
}

function firstAdvisor(b: Builder): string | null {
  return b.catalog.members.find((m) => m.role === "member")?.userId ?? b.catalog.members[0]?.userId ?? null;
}

function profile(
  id: string,
  name: string,
  description: string,
  b: Builder,
  contact: LabContact,
  extra: Partial<LabProfile> = {},
): LabProfile {
  return { id, name, description, contact, cases: b.cases, messages: b.messages, notices: b.notices, ...extra };
}

function builder(catalog: LabCatalog, now: number): Builder {
  return { catalog, now, notices: [], cases: [], messages: [] };
}

/** Prospecto nuevo: aún no existe el contacto; su primer mensaje dispara la bienvenida. */
export function newProspectProfile(catalog: LabCatalog, now: number): LabProfile {
  const b = builder(catalog, now);
  const type = catalog.contactTypes.find((t) => t.isDefault) ?? byName(catalog.contactTypes, "Prospecto", "Contacto");
  if (!type) b.notices.push("El espacio no tiene un tipo de contacto por defecto: el contacto empieza sin tipo.");
  return profile(
    "prospecto-nuevo",
    "Prospecto nuevo",
    "Escribe por primera vez: no existe como contacto, así que se dispara la bienvenida y se abre una gestión nueva.",
    b,
    emptyContact({ name: "Lucía Prospecto", contactTypeId: null, existed: false }),
  );
}

/** Cliente recurrente: ya compró, tiene etiquetas y campos, y su última gestión está cerrada. */
export function returningCustomerProfile(catalog: LabCatalog, now: number): LabProfile {
  const b = builder(catalog, now);
  const contactType = contactTypeNamed(b, "Cliente frecuente", "Cliente", "Socio activo");
  const sale = caseTypeNamed(b, "Venta", "Venta de membresía");
  const won = sale?.stages.find((s) => s.kind === "won");
  const closedAt = minus(now, 12 * DAY);
  if (sale) {
    addCase(b, {
      caseTypeId: sale.id,
      stageId: won?.id ?? null,
      status: "won",
      openedAt: minus(now, 13 * DAY),
      closedAt,
      closedFromStageId: sale.stages.find((s) => s.kind === "open")?.id ?? null,
      lastInboundAt: minus(now, 12 * DAY + 2 * HOUR),
      lastOutboundAt: minus(now, 12 * DAY + HOUR),
      assigneeId: firstAdvisor(b),
    });
  }
  addMessage(b, "client", "Hola, ya hice el pago, gracias", minus(now, 12 * DAY + 2 * HOUR));
  addMessage(b, "agent", "¡Gracias por tu compra, Carlos!", minus(now, 12 * DAY + HOUR), { authorName: "Asesor" });
  const tags = ["Cliente frecuente", "VIP"];
  const unknownTags = tags.filter((t) => catalog.tags.length > 0 && !catalog.tags.includes(t));
  if (unknownTags.length > 0) b.notices.push(`Las etiquetas ${unknownTags.map((t) => `«${t}»`).join(", ")} no existen todavía en el espacio (se usan igual en la simulación).`);
  return profile(
    "cliente-recurrente",
    "Cliente recurrente con etiquetas",
    "Ya compró hace 12 días (gestión ganada y cerrada), tiene las etiquetas «Cliente frecuente» y «VIP» y un producto de interés guardado. Si escribe ahora se abre una gestión nueva.",
    b,
    emptyContact({
      name: "Carlos Recurrente",
      contactTypeId: contactType?.id ?? null,
      tags,
      customFields: { producto_interes: "Proteína whey 2 lb" },
      ownerId: firstAdvisor(b),
      existed: true,
    }),
  );
}

/** Cliente con una Venta en «Esperando pago». */
export function awaitingPaymentProfile(catalog: LabCatalog, now: number): LabProfile {
  const b = builder(catalog, now);
  const contactType = contactTypeNamed(b, "Prospecto", "Contacto");
  const sale = caseTypeNamed(b, "Venta", "Venta de membresía");
  const stage = stageNamed(b, sale, "Esperando pago", "Pedido o enlace de pago enviado");
  const advisor = firstAdvisor(b);
  const inboundAt = minus(now, 3 * HOUR);
  const outboundAt = minus(now, 2 * HOUR + 30 * 60_000);
  if (sale) {
    addCase(b, {
      caseTypeId: sale.id,
      stageId: stage?.id ?? null,
      status: "open",
      openedAt: minus(now, 5 * HOUR),
      assigneeId: advisor,
      assignedAt: minus(now, 5 * HOUR),
      lastInboundAt: inboundAt,
      lastOutboundAt: outboundAt,
      waitingSince: null,
      firstResponseAt: minus(now, 4 * HOUR + 40 * 60_000),
    });
  }
  addMessage(b, "client", "Quiero comprar 2 proteínas, ¿cómo pago?", inboundAt);
  addMessage(b, "agent", "Te envío los datos de pago. Cuando pagues, mándame la captura.", outboundAt, { authorName: advisor ? (catalog.members.find((m) => m.userId === advisor)?.name ?? "Asesor") : "Asesor" });
  return profile(
    "venta-esperando-pago",
    "Cliente con venta en «Esperando pago»",
    "Una Venta abierta en «Esperando pago»: el cliente recibió los datos de pago hace 2,5 horas y no ha respondido. Avanza el tiempo para ver el recordatorio.",
    b,
    emptyContact({ name: "María Pagos", contactTypeId: contactType?.id ?? null, ownerId: advisor, existed: true }),
  );
}

/** Socio con vencimiento en 5 días (y su Renovación ya abierta, «Por vencer»). */
export function expiringMemberProfile(catalog: LabCatalog, now: number): LabProfile {
  const b = builder(catalog, now);
  const contactType = contactTypeNamed(b, "Socio activo", "Cliente");
  const renewal = caseTypeNamed(b, "Renovación");
  const stage = stageNamed(b, renewal, "Por vencer");
  const advisor = firstAdvisor(b);
  const keyDate = addDays(limaDateOf(new Date(now)), 5);
  if (renewal) {
    addCase(b, {
      caseTypeId: renewal.id,
      stageId: stage?.id ?? null,
      status: "open",
      origin: "proactive",
      scheduledFor: limaDateTimeIso(addDays(keyDate, -7)),
      openedAt: minus(now, 2 * DAY),
      assigneeId: advisor,
      assignedAt: minus(now, 2 * DAY),
      lastInboundAt: minus(now, 40 * DAY),
    });
  }
  return profile(
    "socio-por-vencer",
    "Socio con vencimiento en 5 días",
    `Socio activo cuya membresía vence el ${keyDate.split("-").reverse().join("/")}; ya tiene su gestión de Renovación abierta en «Por vencer». Escribió por última vez hace 40 días (ventana de 24 h cerrada).`,
    b,
    emptyContact({ name: "Diego Socio", contactTypeId: contactType?.id ?? null, keyDate, ownerId: advisor, existed: true }),
  );
}

/** Los cuatro perfiles de ejemplo. `now` (ISO) fija el reloj de referencia; por defecto, ahora. */
export function buildSampleProfiles(catalog: LabCatalog, nowIso: string = new Date().toISOString()): LabProfile[] {
  const now = new Date(nowIso).getTime();
  return [
    newProspectProfile(catalog, now),
    returningCustomerProfile(catalog, now),
    awaitingPaymentProfile(catalog, now),
    expiringMemberProfile(catalog, now),
  ].map((p) => ({ ...p, clock: nowIso }));
}
