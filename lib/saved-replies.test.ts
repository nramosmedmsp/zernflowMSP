import { describe, expect, it } from "vitest";
import {
  applyReplyVariables,
  hasShortcutConflict,
  normalizeSearch,
  normalizeShortcut,
  searchSavedReplies,
  validateSavedReplyInput,
  applyReplyVariablesDetailed,
  findUnresolvedPlaceholders,
  greetingFor,
  longDayFor,
  replaceRange,
  slashQueryAt,
} from "./saved-replies";

describe("applyReplyVariables", () => {
  const ctx = {
    contactName: "María",
    agentName: "Nicolás",
    teamName: "Sede Lima",
    workspaceName: "Muscle Shop",
    customFields: { plan: "Anual", Ciudad: "Lima" },
  };

  it("reemplaza todas las variables", () => {
    expect(
      applyReplyVariables("Hola {nombre}, soy {asesor} de {empresa} ({sede}). Plan: {campo:plan}.", ctx),
    ).toBe("Hola María, soy Nicolás de Muscle Shop (Sede Lima). Plan: Anual.");
  });

  it("no distingue mayúsculas en las variables y repite las que aparecen varias veces", () => {
    expect(applyReplyVariables("{NOMBRE} {Nombre}", ctx)).toBe("María María");
  });

  it("busca el campo personalizado sin distinguir mayúsculas del slug", () => {
    expect(applyReplyVariables("{campo:ciudad}", ctx)).toBe("Lima");
  });

  it("deja vacías las variables sin valor, sin llaves", () => {
    const out = applyReplyVariables("Hola {nombre}, plan {campo:plan}, {campo:nada}.", {});
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe("Hola, plan,.");
  });

  it("limpia los espacios al quedar vacía una variable", () => {
    expect(applyReplyVariables("Hola {nombre}, bienvenido", {})).toBe("Hola, bienvenido");
    expect(applyReplyVariables("Hola {nombre}!", {})).toBe("Hola!");
    expect(applyReplyVariables("Hola {nombre} bienvenido", {})).toBe("Hola bienvenido");
    expect(applyReplyVariables("Hola {nombre}", {})).toBe("Hola");
    expect(applyReplyVariables("{nombre}, hola", {})).toBe("hola");
    expect(applyReplyVariables("Línea 1\n{nombre}\nLínea 3", {})).toBe("Línea 1\n\nLínea 3");
  });

  it("trata los valores en blanco como vacíos", () => {
    expect(applyReplyVariables("Hola {nombre}, ok", { contactName: "   " })).toBe("Hola, ok");
  });

  it("no toca llaves que no son variables conocidas ni vuelve a expandir los valores", () => {
    expect(applyReplyVariables("Código {codigo} y {{1}}", ctx)).toBe("Código {codigo} y {{1}}");
    expect(applyReplyVariables("{nombre}", { contactName: "{asesor} $& $1" })).toBe("{asesor} $& $1");
  });

  it("sin contexto no falla", () => {
    expect(applyReplyVariables("Sin variables")).toBe("Sin variables");
  });
});

describe("normalizeSearch", () => {
  it("quita tildes y pasa a minúsculas", () => {
    expect(normalizeSearch("  Información ÚTIL ")).toBe("informacion util");
  });
});

describe("searchSavedReplies", () => {
  const replies = [
    { id: "1", title: "Precios y planes", shortcut: "/precios", caseTypeId: null },
    { id: "2", title: "Dirección de la sede", shortcut: "/direccion", caseTypeId: null },
    { id: "3", title: "Recompra: oferta", shortcut: "/recompra", caseTypeId: "t-recompra" },
    { id: "4", title: "Bienvenida", shortcut: null, caseTypeId: "t-venta" },
    { id: "5", title: "Cotización", shortcut: "/cotiza", caseTypeId: "t-venta" },
  ];

  it("sin búsqueda devuelve todas, con las del tipo de gestión primero", () => {
    expect(searchSavedReplies(replies, "").map((r) => r.id)).toEqual(["4", "5", "2", "1", "3"]);
    expect(searchSavedReplies(replies, "", "t-venta").map((r) => r.id)).toEqual(["4", "5", "2", "1", "3"]);
    expect(searchSavedReplies(replies, "", "t-recompra")[0].id).toBe("3");
  });

  it("busca por título sin tildes ni mayúsculas", () => {
    expect(searchSavedReplies(replies, "direccion").map((r) => r.id)).toEqual(["2"]);
    expect(searchSavedReplies(replies, "COTIZACION").map((r) => r.id)).toEqual(["5"]);
    expect(searchSavedReplies(replies, "dirección").map((r) => r.id)).toEqual(["2"]);
  });

  it("busca por atajo con o sin la barra", () => {
    expect(searchSavedReplies(replies, "/prec").map((r) => r.id)).toEqual(["1"]);
    expect(searchSavedReplies(replies, "prec").map((r) => r.id)).toEqual(["1"]);
    expect(searchSavedReplies(replies, "/").length).toBe(5);
  });

  it("exige que coincidan todas las palabras", () => {
    expect(searchSavedReplies(replies, "precios planes").map((r) => r.id)).toEqual(["1"]);
    expect(searchSavedReplies(replies, "precios sede")).toEqual([]);
  });

  it("prioriza el tipo de gestión indicado aunque coincida peor", () => {
    const list = [
      { id: "a", title: "Oferta especial", shortcut: "/oferta", caseTypeId: null },
      { id: "b", title: "Mi oferta de recompra", shortcut: null, caseTypeId: "t-recompra" },
    ];
    expect(searchSavedReplies(list, "oferta").map((r) => r.id)).toEqual(["a", "b"]);
    expect(searchSavedReplies(list, "oferta", "t-recompra").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("ordena primero el atajo exacto", () => {
    const list = [
      { id: "a", title: "Precios mayoristas", shortcut: "/mayor", caseTypeId: null },
      { id: "b", title: "Lista", shortcut: "/precios", caseTypeId: null },
    ];
    expect(searchSavedReplies(list, "precios").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("no modifica la lista original", () => {
    const copy = [...replies];
    searchSavedReplies(replies, "a", "t-venta");
    expect(replies).toEqual(copy);
  });
});

describe("normalizeShortcut", () => {
  it("agrega la barra y normaliza", () => {
    expect(normalizeShortcut("Precios")).toEqual({ ok: true, value: "/precios" });
    expect(normalizeShortcut("/Información")).toEqual({ ok: true, value: "/informacion" });
    expect(normalizeShortcut("//a_b-1")).toEqual({ ok: true, value: "/a_b-1" });
  });

  it("vacío significa sin atajo", () => {
    expect(normalizeShortcut("")).toEqual({ ok: true, value: null });
    expect(normalizeShortcut(" / ")).toEqual({ ok: true, value: null });
    expect(normalizeShortcut(null)).toEqual({ ok: true, value: null });
  });

  it("rechaza espacios, símbolos y atajos muy largos", () => {
    expect(normalizeShortcut("dos palabras").ok).toBe(false);
    expect(normalizeShortcut("a$b").ok).toBe(false);
    expect(normalizeShortcut("x".repeat(31)).ok).toBe(false);
  });
});

describe("validateSavedReplyInput", () => {
  it("acepta una respuesta completa y la normaliza", () => {
    expect(
      validateSavedReplyInput({ title: "  Precios ", shortcut: "Precios", body: " Hola {nombre} ", caseTypeId: "" }),
    ).toEqual({
      ok: true,
      value: { title: "Precios", shortcut: "/precios", body: "Hola {nombre}", caseTypeId: null },
    });
  });

  it("exige título y texto", () => {
    expect(validateSavedReplyInput({ title: " ", body: "x" }).ok).toBe(false);
    expect(validateSavedReplyInput({ title: "x", body: "  " }).ok).toBe(false);
  });

  it("con archivo, el texto es opcional", () => {
    expect(validateSavedReplyInput({ title: "Lista de precios", body: " ", hasAttachment: true })).toMatchObject({
      ok: true,
      value: { body: "" },
    });
  });

  it("limita el tamaño", () => {
    expect(validateSavedReplyInput({ title: "x".repeat(201), body: "x" }).ok).toBe(false);
    expect(validateSavedReplyInput({ title: "x", body: "x".repeat(4001) }).ok).toBe(false);
  });

  it("propaga el error del atajo", () => {
    const r = validateSavedReplyInput({ title: "x", body: "x", shortcut: "a b" });
    expect(r.ok).toBe(false);
  });
});

describe("hasShortcutConflict", () => {
  const others = [
    { id: "1", shortcut: "/precios" },
    { id: "2", shortcut: null },
  ];
  it("detecta el mismo atajo sin importar mayúsculas", () => {
    expect(hasShortcutConflict("/Precios", others)).toBe(true);
  });
  it("ignora la propia respuesta y los atajos vacíos", () => {
    expect(hasShortcutConflict("/precios", others, "1")).toBe(false);
    expect(hasShortcutConflict(null, others)).toBe(false);
    expect(hasShortcutConflict("/otro", others)).toBe(false);
  });
});

describe("variables nuevas", () => {
  // 27 oct 2026, 10:30 en Lima (15:30 UTC).
  const morning = new Date("2026-10-27T15:30:00.000Z");

  it("{primer_nombre} toma solo el primer nombre", () => {
    expect(applyReplyVariables("Hola {primer_nombre}", { contactName: "Patricia Salas Ríos" })).toBe("Hola Patricia");
  });

  it("{saludo} sigue la hora de Lima", () => {
    expect(greetingFor(new Date("2026-10-27T15:30:00.000Z"))).toBe("Buenos días");
    expect(greetingFor(new Date("2026-10-27T19:00:00.000Z"))).toBe("Buenas tardes");
    expect(greetingFor(new Date("2026-10-28T01:30:00.000Z"))).toBe("Buenas noches");
    expect(greetingFor(new Date("2026-10-27T09:59:00.000Z"))).toBe("Buenas noches");
    expect(applyReplyVariables("{saludo} {primer_nombre} 👋", { contactName: "Ana", now: morning })).toBe("Buenos días Ana 👋");
  });

  it("{hoy} escribe el día en español", () => {
    expect(longDayFor(morning)).toBe("martes 27 de octubre");
  });

  it("dice qué variables quedaron sin dato", () => {
    const r = applyReplyVariablesDetailed("Hola {nombre}, recoge en {sede}.", { contactName: "Ana" });
    expect(r.text).toBe("Hola Ana, recoge en.");
    expect(r.empty).toEqual(["{sede}"]);
  });

  it("{primer_nombre} queda vacío si el nombre es un teléfono", () => {
    expect(applyReplyVariablesDetailed("Hola {primer_nombre}", { contactName: "+51 987 654 321" }).empty).toEqual(["{primer_nombre}"]);
  });
});

describe("findUnresolvedPlaceholders", () => {
  it("encuentra llaves que el cliente vería tal cual", () => {
    expect(findUnresolvedPlaceholders("Hola {nombre}, el precio es {precio} y {precio}")).toEqual(["{nombre}", "{precio}"]);
    expect(findUnresolvedPlaceholders("Sin llaves 🙂")).toEqual([]);
  });
});

describe("slashQueryAt y replaceRange", () => {
  it("detecta / al inicio o después de un espacio", () => {
    expect(slashQueryAt("/pre", 4)).toEqual({ start: 0, query: "pre" });
    expect(slashQueryAt("Gracias 🙌 /pre", "Gracias 🙌 /pre".length)).toEqual({ start: "Gracias 🙌 ".length, query: "pre" });
    expect(slashQueryAt("Gracias /", 9)).toEqual({ start: 8, query: "" });
  });

  it("no se activa en enlaces, fechas ni con un espacio justo después", () => {
    expect(slashQueryAt("https://muscleshop.pe", 21)).toBeNull();
    expect(slashQueryAt("el 27/10", 8)).toBeNull();
    expect(slashQueryAt("1 / 2", 5)).toBeNull();
    expect(slashQueryAt("/pre\nhola", 9)).toBeNull();
  });

  it("pega la respuesta donde está el cursor sin borrar lo escrito", () => {
    const text = "Gracias 🙌 /pre";
    const q = slashQueryAt(text, text.length)!;
    expect(replaceRange(text, q.start, text.length, "Hola Ana")).toEqual({ value: "Gracias 🙌 Hola Ana", caret: "Gracias 🙌 Hola Ana".length });
  });
});

describe("búsqueda por el texto de la respuesta", () => {
  it("encuentra por una palabra del texto, después de título y atajo", () => {
    const replies = [
      { id: "1", title: "Envíos a provincia", shortcut: "/envio", caseTypeId: null, body: "Hacemos envíos por Olva y Shalom" },
      { id: "2", title: "Olva Courier", shortcut: null, caseTypeId: null, body: "Seguimiento" },
    ];
    expect(searchSavedReplies(replies, "olva").map((r) => r.id)).toEqual(["2", "1"]);
  });
});
