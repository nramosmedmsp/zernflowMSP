import { describe, expect, it } from "vitest";
import { detectComplaint } from "./complaint-detect";

describe("detectComplaint", () => {
  it.each([
    ["Quiero poner un reclamo", "reclamo"],
    ["tengo una QUEJA con mi pedido", "queja"],
    ["voy a quejarme en Indecopi", "quejarme"],
    ["Hola, el pote llegó roto", "llegó roto"],
    ["el pote LLEGO ROTO!!", "llegó roto"],
    ["me llegó dañado el empaque", "llegó dañado"],
    ["llegaron rotos los sobres", "llegaron rotos"],
    ["el producto está vencido", "vencido"],
    ["ya venció hace un mes", "venció"],
    ["mi pedido no llegó", "no llegó"],
    ["no me llegó nada", "no me llegó"],
    ["nunca llego mi paquete", "nunca llegó"],
    ["quiero una devolución", "devolución"],
    ["Quiero DEVOLUCION del dinero", "devolución"],
    ["lo quiero devolver", "quiero devolver"],
    ["quiero devolver el producto", "quiero devolver"],
    ["necesito devolver mi dinero", "devolver mi dinero"],
    ["que me devuelvan la plata", "me devuelvan"],
    ["pido reembolso", "reembolso"],
    ["me estafaron", "me estafaron"],
    ["esto es una estafa", "estafa"],
    ["es un fraude", "fraude"],
    ["parece falsificado", "falsificado"],
    ["esta proteína no es original", "no es original"],
    ["llegó en mal estado", "mal estado"],
    ["el pedido está incompleto", "incompleto"],
    ["viene malogrado", "malogrado"],
    ["salió defectuoso", "defectuoso"],
  ])("detecta «%s»", (text, phrase) => {
    expect(detectComplaint(text)?.phrase).toBe(phrase);
  });

  it("devuelve lo escrito por el cliente, con sus tildes y mayúsculas", () => {
    expect(detectComplaint("Buenas, el pote LLEGÓ ROTO y nadie responde")?.excerpt).toBe("LLEGÓ ROTO");
    expect(detectComplaint("el pote  llegó\nroto")?.excerpt).toBe("llegó roto");
  });

  it("prefiere la frase más larga que empieza en el mismo lugar", () => {
    expect(detectComplaint("me llegó roto")?.phrase).toBe("llegó roto");
    expect(detectComplaint("el pote no llegó, ¿dónde está?")?.phrase).toBe("no llegó");
  });

  it("la ñ no se confunde con la n", () => {
    expect(detectComplaint("llego danado")?.phrase).toBe("llegó dañado");
    expect(detectComplaint("llego dañado")?.phrase).toBe("llegó dañado");
  });

  it.each([
    "Hola, buenas tardes",
    "Quiero comprar una proteína isolate",
    "¿Cuánto cuesta el envío a Arequipa?",
    "Mi pedido llegó perfecto, gracias",
    "Pasé por la rotonda y no vi la tienda",
    "¿Tienen creatina en polvo?",
    "Ok, ya pagué por Yape",
    "¿A qué hora llega mi pedido?",
    "Me gustaría reclamar mi premio del sorteo",
    "¿me puedes devolver la llamada?",
    "Devuélveme la llamada cuando puedas",
    "el pote no está roto, gracias",
    "no llegó roto, llegó bien",
    "nada roto, todo perfecto",
    "sin daños y sellado, gracias",
    "no está vencido, la fecha es 2027",
    "",
    "   ",
  ])("no marca «%s»", (text) => {
    expect(detectComplaint(text)).toBeNull();
  });

  it("acepta valores vacíos", () => {
    expect(detectComplaint(null)).toBeNull();
    expect(detectComplaint(undefined)).toBeNull();
  });
});
