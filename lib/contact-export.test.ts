import { describe, expect, it } from "vitest";
import { escapeHtml, exportFileName, renderContactExportHtml, type ContactExport } from "./contact-export";

function base(): ContactExport {
  return {
    generatedAt: "2026-11-12T15:00:00.000Z",
    generatedBy: "Ana Admin",
    businessName: "Muscle Shop",
    contact: {
      name: "María <b>Pérez</b>",
      phone: "+51987654321",
      email: null,
      type: "Cliente",
      origin: "Importación: lista.csv",
      keyDateLabel: "Última compra",
      keyDate: "2026-10-01",
      owner: "Ana Admin",
      team: null,
      createdAt: "2026-09-01T10:00:00.000Z",
      lastInteractionAt: null,
      tags: ["VIP"],
      customFields: [{ name: "Objetivo", value: "Ganar masa" }],
    },
    consent: { status: "Aceptó publicidad", at: "2026-10-02T10:00:00.000Z", source: "anotado por un asesor", setBy: "Ana Admin", note: "Por teléfono" },
    channels: [{ platform: "WhatsApp", account: "Tienda", identifier: "51987654321" }],
    conversations: [
      {
        platform: "WhatsApp",
        channel: "Tienda",
        status: "Abierta",
        warning: "No se pudieron leer los mensajes desde Zernio en este momento.",
        messages: [
          { at: "2026-10-02T10:00:00.000Z", who: "Cliente", text: "Hola\n<script>alert(1)</script>", files: ["foto.jpg"] },
          { at: "2026-10-02T10:01:00.000Z", who: "Tienda (Ana)", text: "", files: [] },
        ],
      },
    ],
    cases: [
      {
        type: "Venta",
        status: "Ganada",
        origin: "Mensaje del cliente",
        openedAt: "2026-10-02T10:00:00.000Z",
        closedAt: null,
        stage: "Cerrada",
        outcome: null,
        outcomeNote: null,
        nextActionAt: null,
        nextActionNote: null,
        notes: [{ at: "2026-10-03T10:00:00.000Z", author: "Ana", body: "Quiere proteína & creatina" }],
      },
    ],
    broadcasts: [{ name: "Promo", at: null, status: "Enviada" }],
    sequences: [],
    history: [{ at: "2026-10-02T10:00:00.000Z", title: "Se abrió la gestión Venta", detail: null, actor: "Sistema" }],
    notices: ["Esta copia reúne lo que guarda el CRM."],
  };
}

describe("copia imprimible de los datos de un cliente", () => {
  const html = renderContactExportHtml(base());

  it("es una página completa en español, sin scripts ni recursos externos", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("Imprimir");
  });

  it("incluye datos, permiso de publicidad, conversaciones, gestiones, notas e historial", () => {
    for (const text of [
      "Datos personales",
      "+51987654321",
      "Permiso para recibir publicidad",
      "Aceptó publicidad",
      "Conversaciones",
      "foto.jpg",
      "Gestiones y notas",
      "Quiere proteína &amp; creatina",
      "Historial de movimientos",
      "Se abrió la gestión Venta",
      "Promo",
      "Objetivo",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("escapa todo lo que viene de los datos del cliente", () => {
    expect(html).not.toContain("<b>Pérez</b>");
    expect(html).toContain("María &lt;b&gt;Pérez&lt;/b&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("muestra el aviso cuando no se pudieron leer los mensajes", () => {
    expect(html).toContain("No se pudieron leer los mensajes desde Zernio");
  });

  it("un cliente sin nada igual genera una página válida", () => {
    const empty = renderContactExportHtml({
      ...base(),
      channels: [],
      conversations: [],
      cases: [],
      broadcasts: [],
      sequences: [],
      history: [],
    });
    expect(empty).toContain("Sin conversaciones.");
    expect(empty).toContain("Sin gestiones.");
    expect(empty).toContain("Sin movimientos.");
  });
});

describe("utilidades", () => {
  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
  });

  it("nombre del archivo sin tildes ni símbolos", () => {
    expect(exportFileName("María Pérez/Ñandú", new Date("2026-11-12T10:00:00Z"))).toBe("datos-maria-perez-nandu-2026-11-12.html");
    expect(exportFileName(null, new Date("2026-11-12T10:00:00Z"))).toBe("datos-cliente-2026-11-12.html");
  });
});
