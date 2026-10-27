import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

const links = (text: string) => linkify(text).filter((p) => p.type === "link");

describe("linkify", () => {
  it("detecta enlaces http, https y www.", () => {
    expect(links("Mira https://muscleshop.pe/isolate y www.olva.com.pe")).toEqual([
      { type: "link", value: "https://muscleshop.pe/isolate", href: "https://muscleshop.pe/isolate" },
      { type: "link", value: "www.olva.com.pe", href: "https://www.olva.com.pe" },
    ]);
  });

  it("deja fuera la puntuación final y conserva el resto del texto", () => {
    const parts = linkify("¿Viste https://muscleshop.pe/promo? Avísame.");
    expect(parts).toEqual([
      { type: "text", value: "¿Viste " },
      { type: "link", value: "https://muscleshop.pe/promo", href: "https://muscleshop.pe/promo" },
      { type: "text", value: "? Avísame." },
    ]);
  });

  it("respeta los paréntesis que son parte del enlace y quita el de cierre de la frase", () => {
    expect(links("(ver https://es.wikipedia.org/wiki/Creatina_(compuesto))")[0].value).toBe(
      "https://es.wikipedia.org/wiki/Creatina_(compuesto)",
    );
    expect(links("(ver https://muscleshop.pe)")[0].value).toBe("https://muscleshop.pe");
  });

  it("no convierte otros esquemas en enlaces", () => {
    expect(links("javascript:alert(1) data:text/html,hola")).toEqual([]);
  });

  it("un texto sin enlaces queda igual", () => {
    expect(linkify("Hola Patricia")).toEqual([{ type: "text", value: "Hola Patricia" }]);
  });
});
