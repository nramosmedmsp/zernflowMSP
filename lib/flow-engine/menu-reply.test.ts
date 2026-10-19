import { describe, expect, it } from "vitest";
import { adaptMessage } from "./platform-adapter";
import {
  MENU_VARIABLE,
  applyMenuReply,
  applyWaitingMenuReply,
  menuFromMessage,
  normalizeReply,
  readMenu,
  recordMenu,
  resolveMenuChoice,
  type Menu,
} from "./menu-reply";

const buttons: Menu = {
  kind: "button",
  options: [
    { title: "Quiero comprar", payload: "quiero_comprar" },
    { title: "Mi pedido", payload: "mi_pedido" },
    { title: "Otra consulta" },
  ],
};

describe("menuFromMessage", () => {
  it("toma los botones, o las respuestas rápidas si no hay botones", () => {
    expect(
      menuFromMessage({ buttons: [{ title: "Sí", type: "postback", payload: "si" }, { title: "Web", type: "url", url: "https://x.pe" }] }),
    ).toEqual({ kind: "button", options: [{ title: "Sí", payload: "si" }, { title: "Web", link: true }] });
    expect(menuFromMessage({ quickReplies: [{ title: "Hoy", payload: "hoy" }, { title: "Mañana", payload: "manana" }] })).toEqual({
      kind: "quick_reply",
      options: [{ title: "Hoy", payload: "hoy" }, { title: "Mañana", payload: "manana" }],
    });
  });

  it("sin opciones, con carrusel o sin mensaje no hay menú", () => {
    expect(menuFromMessage({})).toBeNull();
    expect(menuFromMessage(null)).toBeNull();
    expect(menuFromMessage({ carousel: { elements: [] }, buttons: [{ title: "Ver", type: "postback", payload: "v" }] })).toBeNull();
  });

  it("la numeración coincide con la lista numerada que arma el adaptador de WhatsApp (más de 3 botones)", () => {
    const message = {
      text: "Elige",
      buttons: ["Uno", "Dos", "Tres", "Cuatro"].map((title) => ({ title, type: "postback" as const, payload: title.toLowerCase() })),
    };
    const adapted = adaptMessage(message, "whatsapp");
    expect(adapted.text).toContain("4. Cuatro");
    expect(resolveMenuChoice("4", menuFromMessage(message))?.title).toBe("Cuatro");
  });
});

describe("recordMenu / readMenu", () => {
  it("guarda el menú del último mensaje del nodo y lo quita si no tiene opciones", () => {
    const variables: Record<string, string> = { otra: "x" };
    recordMenu(variables, [{ buttons: [{ title: "Sí", type: "postback", payload: "si" }] }]);
    expect(readMenu(variables)).toEqual({ kind: "button", options: [{ title: "Sí", payload: "si" }] });
    recordMenu(variables, [{ buttons: [{ title: "Sí", type: "postback", payload: "si" }] }, { quickReplies: [{ title: "No", payload: "no" }] }]);
    expect(readMenu(variables)?.options.map((o) => o.title)).toEqual(["No"]);
    // El último mensaje no tiene opciones: el menú anterior ya no cuenta.
    recordMenu(variables, [{ quickReplies: [{ title: "No", payload: "no" }] }, {}]);
    expect(variables[MENU_VARIABLE]).toBeUndefined();
    expect(variables.otra).toBe("x");
    recordMenu(variables, null);
    expect(variables[MENU_VARIABLE]).toBeUndefined();
  });

  it("ignora valores que no son un menú", () => {
    expect(readMenu(undefined)).toBeNull();
    expect(readMenu({})).toBeNull();
    expect(readMenu({ [MENU_VARIABLE]: "no es json" })).toBeNull();
    expect(readMenu({ [MENU_VARIABLE]: JSON.stringify({ kind: "otro", options: [] }) })).toBeNull();
    expect(readMenu({ [MENU_VARIABLE]: JSON.stringify({ kind: "button", options: [] }) })).toBeNull();
  });
});

describe("normalizeReply", () => {
  it("minúsculas, sin tildes y con espacios normalizados", () => {
    expect(normalizeReply("  ÉSTÁ   Bien ")).toBe("esta bien");
  });
});

describe("resolveMenuChoice", () => {
  it("un número elige la opción en esa posición", () => {
    expect(resolveMenuChoice("1", buttons)?.title).toBe("Quiero comprar");
    expect(resolveMenuChoice(" 2 ", buttons)?.title).toBe("Mi pedido");
    expect(resolveMenuChoice("3", buttons)?.title).toBe("Otra consulta");
  });

  it("acepta un punto, paréntesis o dos puntos detrás del número", () => {
    expect(resolveMenuChoice("2.", buttons)?.title).toBe("Mi pedido");
    expect(resolveMenuChoice("1)", buttons)?.title).toBe("Quiero comprar");
    expect(resolveMenuChoice("3:", buttons)?.title).toBe("Otra consulta");
  });

  it("un número fuera de rango, o con más texto, no elige nada", () => {
    expect(resolveMenuChoice("0", buttons)).toBeNull();
    expect(resolveMenuChoice("4", buttons)).toBeNull();
    expect(resolveMenuChoice("1 por favor", buttons)).toBeNull();
    expect(resolveMenuChoice("quiero 2 unidades", buttons)).toBeNull();
    expect(resolveMenuChoice("1.5", buttons)).toBeNull();
  });

  it("el texto exacto de una opción elige, sin importar mayúsculas ni tildes", () => {
    const menu: Menu = { kind: "quick_reply", options: [{ title: "Sí, quiero" }, { title: "Más información", payload: "info" }] };
    expect(resolveMenuChoice("SI, QUIERO", menu)?.title).toBe("Sí, quiero");
    expect(resolveMenuChoice("mas informacion", menu)?.payload).toBe("info");
    expect(resolveMenuChoice("  más   información ", menu)?.title).toBe("Más información");
    expect(resolveMenuChoice("más info", menu)).toBeNull();
  });

  it("una opción con enlace cuenta en la numeración pero no se puede elegir", () => {
    const menu: Menu = { kind: "button", options: [{ title: "Ver catálogo", link: true }, { title: "Hablar", payload: "hablar" }] };
    expect(resolveMenuChoice("1", menu)).toBeNull();
    expect(resolveMenuChoice("Ver catálogo", menu)).toBeNull();
    expect(resolveMenuChoice("2", menu)?.title).toBe("Hablar");
  });

  it("sin menú o sin texto no elige nada", () => {
    expect(resolveMenuChoice("1", null)).toBeNull();
    expect(resolveMenuChoice("", buttons)).toBeNull();
    expect(resolveMenuChoice(undefined, buttons)).toBeNull();
  });
});

describe("applyMenuReply", () => {
  it("reemplaza el texto por el título y agrega la carga del botón (postback)", () => {
    const result = applyMenuReply({ text: "1" }, buttons);
    expect(result.incoming).toEqual({ text: "Quiero comprar", postbackPayload: "quiero_comprar" });
    expect(result.choice?.title).toBe("Quiero comprar");
    expect(result.original).toBe("1");
  });

  it("con respuestas rápidas la carga viaja como respuesta rápida", () => {
    const menu: Menu = { kind: "quick_reply", options: [{ title: "Hoy", payload: "hoy" }] };
    expect(applyMenuReply({ text: "HOY" }, menu).incoming).toEqual({ text: "Hoy", quickReplyPayload: "hoy" });
  });

  it("una opción sin carga solo reemplaza el texto", () => {
    expect(applyMenuReply({ text: "3." }, buttons).incoming).toEqual({ text: "Otra consulta" });
  });

  it("no toca una pulsación real (con carga) ni un texto que no elige nada", () => {
    const click = { text: "Mi pedido", postbackPayload: "mi_pedido" };
    expect(applyMenuReply(click, buttons)).toEqual({ incoming: click, choice: null });
    const quick = { text: "2", quickReplyPayload: "x" };
    expect(applyMenuReply(quick, buttons).incoming).toBe(quick);
    const other = { text: "hola" };
    expect(applyMenuReply(other, buttons)).toEqual({ incoming: other, choice: null });
    expect(applyMenuReply({ text: "1" }, null).choice).toBeNull();
  });

  it("no modifica el mensaje que recibe", () => {
    const original = { text: "2" };
    applyMenuReply(original, buttons);
    expect(original).toEqual({ text: "2" });
  });

  it("applyWaitingMenuReply lee el menú de las variables de la sesión", () => {
    const variables = { [MENU_VARIABLE]: JSON.stringify(buttons) };
    expect(applyWaitingMenuReply(variables, { text: "2" }).incoming.text).toBe("Mi pedido");
    expect(applyWaitingMenuReply({}, { text: "2" }).incoming.text).toBe("2");
  });
});
