import { describe, expect, it } from "vitest";
import { CSV_BOM, toCsv } from "./csv";

const body = (rows: (string | number | null)[][]) => toCsv(["col"], rows).slice(CSV_BOM.length).split("\r\n")[1];

describe("toCsv: celdas que Excel podría tomar por fórmula (SEG-16)", () => {
  it.each(["=SUMA(A1)", "+1+1", "-cmd", "@usuario", "\tfórmula", "\rfórmula"])("antepone ' a %j", (text) => {
    const line = body([[text]]);
    // Las celdas con CR se entrecomillan; en todos los casos el apóstrofo va antes del texto.
    expect(line.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("no toca números ni textos normales", () => {
    expect(body([[-5]])).toBe("-5");
    expect(body([["-5,5"]])).toBe("-5,5");
    expect(body([["María"]])).toBe("María");
    expect(body([["a=b"]])).toBe("a=b");
  });

  it("mantiene BOM, separador ; y saltos CRLF", () => {
    const csv = toCsv(["a", "b"], [["x", 1.5]]);
    expect(csv).toBe(`${CSV_BOM}a;b\r\nx;1,5\r\n`);
  });

  it("entrecomilla lo que lleva ; comillas o saltos de línea", () => {
    expect(body([['dice "hola"; adiós']])).toBe('"dice ""hola""; adiós"');
  });
});
