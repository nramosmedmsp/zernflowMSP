// Exportar "todo lo que tenemos de este cliente" (PRIV-06, derecho de acceso).
//
// Formato elegido: UNA página web (HTML) autónoma e imprimible. Se abre con
// doble clic en cualquier computadora o celular, sin programas especiales, se
// lee tal cual y, con "Imprimir" -> "Guardar como PDF", se convierte en PDF para
// entregarla. No usa librerías de PDF (nada que se rompa ni que sume peso a la
// app), ni scripts, ni imágenes externas: todo el estilo va dentro del archivo.
// Este módulo es puro: arma el documento desde datos ya leídos y lo escapa.

import { formatDateTime } from "@/lib/format";
import { marketingSourceLabel, marketingStatusLabel } from "@/lib/consent";

export interface ExportMessage {
  at: string;
  /** "Cliente", "Tienda (Ana Torres)", "Asistente automático"... */
  who: string;
  text: string;
  /** Nombres de los archivos adjuntos (el archivo en sí no va en esta página). */
  files: string[];
}

export interface ExportConversation {
  platform: string;
  channel: string;
  status: string;
  messages: ExportMessage[];
  /** Aviso cuando no se pudieron leer o se cortó la lista. */
  warning: string | null;
}

export interface ExportCase {
  type: string;
  status: string;
  origin: string;
  openedAt: string | null;
  closedAt: string | null;
  stage: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  notes: { at: string; author: string; body: string }[];
}

export interface ExportHistoryItem {
  at: string;
  title: string;
  detail: string | null;
  actor: string;
}

export interface ContactExport {
  generatedAt: string;
  generatedBy: string;
  businessName: string;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    type: string | null;
    origin: string;
    keyDateLabel: string;
    keyDate: string | null;
    owner: string | null;
    team: string | null;
    createdAt: string;
    lastInteractionAt: string | null;
    tags: string[];
    customFields: { name: string; value: string }[];
  };
  consent: {
    status: string;
    at: string | null;
    source: string | null;
    setBy: string | null;
    note: string | null;
  };
  channels: { platform: string; account: string; identifier: string }[];
  conversations: ExportConversation[];
  cases: ExportCase[];
  broadcasts: { name: string; at: string | null; status: string }[];
  sequences: { name: string; status: string; enrolledAt: string | null }[];
  history: ExportHistoryItem[];
  /** Cosas que no entran en la página y conviene decir. */
  notices: string[];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function when(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "—";
}

function line(label: string, value: string | null | undefined): string {
  const text = value && value.trim() ? escapeHtml(value) : "<span class=\"empty\">—</span>";
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${text}</td></tr>`;
}

function section(title: string, body: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; background: #fff; margin: 0; }
  main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1a1a1a; }
  h3 { font-size: 14px; margin: 16px 0 6px; }
  p { margin: 4px 0; }
  .meta { color: #555; font-size: 13px; }
  .howto { background: #f3f3f3; border-radius: 6px; padding: 10px 12px; margin: 16px 0; font-size: 13px; }
  .notice { background: #fff6e0; border: 1px solid #e5c97a; border-radius: 6px; padding: 8px 12px; margin: 8px 0; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid #e3e3e3; }
  th[scope="row"] { width: 34%; font-weight: 600; color: #333; }
  thead th { background: #f3f3f3; font-size: 13px; }
  .empty { color: #888; }
  .msg { padding: 6px 0; border-bottom: 1px solid #eee; page-break-inside: avoid; }
  .msg .who { font-weight: 600; font-size: 13px; }
  .msg .at { color: #666; font-size: 12px; margin-left: 6px; }
  .msg .files { color: #555; font-size: 12px; }
  .case { border: 1px solid #ccc; border-radius: 6px; padding: 8px 12px; margin: 10px 0; page-break-inside: avoid; }
  ul { margin: 4px 0; padding-left: 20px; }
  @media print { .howto { display: none; } main { padding: 0; } a { color: inherit; } }
`;

export function renderContactExportHtml(d: ContactExport): string {
  const c = d.contact;
  const parts: string[] = [];

  parts.push(
    section(
      "Datos personales",
      `<table>${[
        line("Nombre", c.name),
        line("Teléfono", c.phone),
        line("Correo", c.email),
        line("Tipo de contacto", c.type),
        line("Cómo llegó a la tienda", c.origin),
        line(c.keyDateLabel, c.keyDate),
        line("Atendido por", c.owner),
        line("Equipo", c.team),
        line("Registrado el", when(c.createdAt)),
        line("Última interacción", when(c.lastInteractionAt)),
        line("Etiquetas", c.tags.join(", ")),
        ...c.customFields.map((f) => line(f.name, f.value)),
      ].join("")}</table>`,
    ),
  );

  parts.push(
    section(
      "Permiso para recibir publicidad",
      `<table>${[
        line("Estado", d.consent.status),
        line("Desde", when(d.consent.at)),
        line("Cómo se anotó", d.consent.source),
        line("Anotado por", d.consent.setBy),
        line("Nota", d.consent.note),
      ].join("")}</table>`,
    ),
  );

  parts.push(
    section(
      "Cuentas de mensajería",
      d.channels.length === 0
        ? "<p class=\"empty\">Ninguna.</p>"
        : `<table><thead><tr><th>Plataforma</th><th>Cuenta de la tienda</th><th>Identificador del cliente</th></tr></thead><tbody>${d.channels
            .map((x) => `<tr><td>${escapeHtml(x.platform)}</td><td>${escapeHtml(x.account)}</td><td>${escapeHtml(x.identifier)}</td></tr>`)
            .join("")}</tbody></table>`,
    ),
  );

  parts.push(
    section(
      "Conversaciones",
      d.conversations.length === 0
        ? "<p class=\"empty\">Sin conversaciones.</p>"
        : d.conversations
            .map(
              (conv) =>
                `<h3>${escapeHtml(conv.platform)} · ${escapeHtml(conv.channel)} · ${escapeHtml(conv.status)}</h3>` +
                (conv.warning ? `<p class="notice">${escapeHtml(conv.warning)}</p>` : "") +
                (conv.messages.length === 0
                  ? "<p class=\"empty\">Sin mensajes.</p>"
                  : conv.messages
                      .map(
                        (m) =>
                          `<div class="msg"><span class="who">${escapeHtml(m.who)}</span><span class="at">${escapeHtml(when(m.at))}</span><div>${multiline(m.text || "(sin texto)")}</div>${
                            m.files.length ? `<div class="files">Archivos: ${m.files.map(escapeHtml).join(", ")}</div>` : ""
                          }</div>`,
                      )
                      .join("")),
            )
            .join(""),
    ),
  );

  parts.push(
    section(
      "Gestiones y notas",
      d.cases.length === 0
        ? "<p class=\"empty\">Sin gestiones.</p>"
        : d.cases
            .map(
              (g) =>
                `<div class="case"><strong>${escapeHtml(g.type)}</strong> · ${escapeHtml(g.status)}<table>${[
                  line("Cómo empezó", g.origin),
                  line("Abierta", when(g.openedAt)),
                  line("Cerrada", when(g.closedAt)),
                  line("Etapa", g.stage),
                  line("Resultado", g.outcome),
                  line("Nota del resultado", g.outcomeNote),
                  line("Próximo contacto", g.nextActionAt ? when(g.nextActionAt) : null),
                  line("Nota del próximo contacto", g.nextActionNote),
                ].join("")}</table>${
                  g.notes.length
                    ? `<h3>Notas internas</h3><ul>${g.notes
                        .map((n) => `<li>${escapeHtml(when(n.at))} · ${escapeHtml(n.author)}: ${multiline(n.body)}</li>`)
                        .join("")}</ul>`
                    : ""
                }</div>`,
            )
            .join(""),
    ),
  );

  if (d.broadcasts.length > 0 || d.sequences.length > 0) {
    parts.push(
      section(
        "Mensajes de publicidad y secuencias",
        (d.broadcasts.length
          ? `<h3>Difusiones</h3><ul>${d.broadcasts
              .map((b) => `<li>${escapeHtml(b.name)} · ${escapeHtml(b.status)} · ${escapeHtml(when(b.at))}</li>`)
              .join("")}</ul>`
          : "") +
          (d.sequences.length
            ? `<h3>Secuencias de mensajes</h3><ul>${d.sequences
                .map((s) => `<li>${escapeHtml(s.name)} · ${escapeHtml(s.status)} · desde ${escapeHtml(when(s.enrolledAt))}</li>`)
                .join("")}</ul>`
            : ""),
      ),
    );
  }

  parts.push(
    section(
      "Historial de movimientos",
      d.history.length === 0
        ? "<p class=\"empty\">Sin movimientos.</p>"
        : `<table><thead><tr><th>Fecha</th><th>Qué pasó</th><th>Quién</th></tr></thead><tbody>${d.history
            .map(
              (h) =>
                `<tr><td>${escapeHtml(when(h.at))}</td><td>${escapeHtml(h.title)}${
                  h.detail ? `<br><span class="meta">${escapeHtml(h.detail)}</span>` : ""
                }</td><td>${escapeHtml(h.actor)}</td></tr>`,
            )
            .join("")}</tbody></table>`,
    ),
  );

  const notices = d.notices.map((n) => `<p class="notice">${escapeHtml(n)}</p>`).join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(`Datos de ${c.name ?? "cliente"} – ${d.businessName}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Datos que ${escapeHtml(d.businessName)} guarda de ${escapeHtml(c.name ?? "este cliente")}</h1>
<p class="meta">Copia generada el ${escapeHtml(when(d.generatedAt))} por ${escapeHtml(d.generatedBy)}.</p>
<p class="howto">Para guardarla como PDF o imprimirla, usa «Imprimir» del navegador (Ctrl+P, o Cmd+P en Mac) y elige «Guardar como PDF». Esta nota no sale en la impresión.</p>
${notices}
${parts.join("\n")}
</main>
</body>
</html>`;
}

/** Texto del consentimiento para el documento. */
export function consentForExport(input: {
  status: unknown;
  at: string | null;
  source: string | null;
  setBy: string | null;
  note: string | null;
}): ContactExport["consent"] {
  return {
    status: marketingStatusLabel(input.status),
    at: input.at,
    source: marketingSourceLabel(input.source),
    setBy: input.setBy,
    note: input.note,
  };
}

/** Nombre del archivo al descargarlo: sin tildes, espacios ni símbolos. */
export function exportFileName(name: string | null | undefined, now: Date = new Date()): string {
  const base = (name ?? "cliente")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `datos-${base || "cliente"}-${now.toISOString().slice(0, 10)}.html`;
}
