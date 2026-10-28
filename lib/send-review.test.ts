import { describe, expect, it } from "vitest";
import { applySuggestions, reviewOutgoing } from "./send-review";

const fixes = (text: string) => reviewOutgoing(text).suggestions.map((s) => `${s.from}→${s.to}`);
const corrected = (text: string) => applySuggestions(text, reviewOutgoing(text).suggestions);

describe("reviewOutgoing: tildes seguras", () => {
  it("corrige las palabras que siempre llevan tilde", () => {
    expect(corrected("asi es, tambien va la proteina y ademas el codigo")).toBe("así es, también va la proteína y además el código");
    expect(corrected("te paso mi numero de telefono en 2 dias")).toBe("te paso mi número de teléfono en 2 días");
  });

  it("respeta mayúsculas", () => {
    expect(corrected("Asi es")).toBe("Así es");
    expect(corrected("ASI ES")).toBe("ASÍ ES");
  });

  it("-cion y -sion en singular", () => {
    expect(corrected("Pásame tu direccion y la informacion de la promocion")).toBe("Pásame tu dirección y la información de la promoción");
    expect(corrected("la ultima version")).toBe("la ultima versión");
    expect(fixes("las promociones")).toEqual([]);
  });

  it("envio solo es envío después de el, su, tu, mi, del, un, de", () => {
    expect(corrected("el envio sale hoy")).toBe("el envío sale hoy");
    expect(corrected("costo de envio")).toBe("costo de envío");
    expect(fixes("ya le envio el pedido")).toEqual([]);
  });

  it("nunca toca las palabras que dependen del contexto", () => {
    expect(fixes("como esta tu pedido, mas tarde si te escribo, el solo pide eso que")).toEqual([]);
  });
});

describe("reviewOutgoing: abreviaturas", () => {
  it("q, xq, pq, tb, tmb y x favor", () => {
    expect(corrected("dime q sabor quieres, tb tenemos vainilla")).toBe("dime que sabor quieres, también tenemos vainilla");
    expect(corrected("no llegó xq faltaba la dirección. x favor confirma")).toBe("no llegó porque faltaba la dirección. por favor confirma");
    expect(corrected("tmb")).toBe("también");
  });

  it("xq al inicio de una pregunta es «por qué»", () => {
    expect(corrected("¿xq no te llegó?")).toBe("¿por qué no te llegó?");
  });
});

describe("reviewOutgoing: signos de apertura", () => {
  it("agrega ¿ al inicio de la pregunta", () => {
    expect(corrected("Quieres que te separe otra?")).toBe("¿Quieres que te separe otra?");
    expect(corrected("Te llegó. Quieres otra?")).toBe("Te llegó. ¿Quieres otra?");
  });

  it("después del saludo con coma", () => {
    expect(corrected("Hola Ana, como estás?")).toBe("Hola Ana, ¿cómo estás?");
  });

  it("agrega ¡ en exclamaciones", () => {
    expect(corrected("Gracias por tu compra!")).toBe("¡Gracias por tu compra!");
  });

  it("no duplica el signo ni lo pone por un ? dentro de un enlace", () => {
    expect(fixes("¿Tienes stock?")).toEqual([]);
    expect(fixes("Mira https://muscleshop.pe/isolate?utm=wa")).toEqual([]);
  });

  it("muestra la frase antes y después", () => {
    const [s] = reviewOutgoing("Puedo pagar con Plin?").suggestions;
    expect(s.preview).toEqual({ before: "Puedo pagar con Plin?", after: "¿Puedo pagar con Plin?" });
  });
});

describe("reviewOutgoing: lo que no se revisa", () => {
  it("enlaces, correos, @menciones y variables", () => {
    expect(fixes("https://muscleshop.pe/asi ventas.tambien@muscleshop.pe @asi {asi}")).toEqual([]);
  });

  it("avisa las llaves que quedaron sin reemplazar", () => {
    expect(reviewOutgoing("Recoge en {sede}").unresolved).toEqual(["{sede}"]);
  });

  it("un mensaje correcto no tiene sugerencias", () => {
    expect(reviewOutgoing("¡Hola Patricia! Sí, la tenemos. ¿Te la envío hoy?")).toEqual({ suggestions: [], unresolved: [] });
  });
});

describe("applySuggestions", () => {
  it("aplica solo las elegidas", () => {
    const text = "asi es, tambien";
    const [first] = reviewOutgoing(text).suggestions;
    expect(applySuggestions(text, [first])).toBe("así es, tambien");
  });
});

describe("reviewOutgoing: tildes en preguntas", () => {
  const fix = (text: string) => applySuggestions(text, reviewOutgoing(text).suggestions);
  const sources = (text: string) => reviewOutgoing(text).suggestions.filter((x) => x.kind === "word").map((x) => `${x.from}:${x.source}`);

  it("la palabra que abre la pregunta lleva tilde", () => {
    expect(fix("como estas?")).toBe("¿cómo estás?");
    expect(fix("Cuanto cuesta la whey?")).toBe("¿Cuánto cuesta la whey?");
    expect(fix("Hola Patricia, donde te lo enviamos?")).toBe("Hola Patricia, ¿dónde te lo enviamos?");
    expect(fix("por que no te llegó?")).toBe("¿por qué no te llegó?");
    expect(sources("como estas?")).toEqual(["como:pregunta", "estas:pregunta"]);
  });

  it("fuera de una pregunta, o en medio de ella, no toca nada", () => {
    expect(reviewOutgoing("como te dije, llega mañana.").suggestions).toEqual([]);
    expect(reviewOutgoing("sabes como llegar?").suggestions.filter((x) => x.kind === "word")).toEqual([]);
    expect(reviewOutgoing("es lo que pediste?").suggestions.filter((x) => x.kind === "word")).toEqual([]);
  });
});
