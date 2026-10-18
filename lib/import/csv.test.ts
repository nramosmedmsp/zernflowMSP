import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectDelimiter, parseCsv, toCsv } from "./csv";

describe("decodeCsvBytes", () => {
  it("lee UTF-8 y quita el BOM", () => {
    const bytes = new Uint8Array(Buffer.from("﻿nombre\nJosé", "utf8"));
    expect(decodeCsvBytes(bytes)).toEqual({ text: "nombre\nJosé", encoding: "utf-8" });
  });
  it("cae a Latin-1 cuando no es UTF-8", () => {
    const bytes = new Uint8Array(Buffer.from("nombre;José Muñoz", "latin1"));
    const out = decodeCsvBytes(bytes);
    expect(out.encoding).toBe("latin-1");
    expect(out.text).toBe("nombre;José Muñoz");
  });
});

describe("detectDelimiter", () => {
  it("elige coma, punto y coma o tabulación", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });
  it("ignora separadores dentro de comillas y empata a coma", () => {
    expect(detectDelimiter('"a,b,c";d\n1;2')).toBe(";");
    expect(detectDelimiter("solo")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("separa filas y columnas con CRLF o LF", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("entiende comillas, comillas escapadas y saltos dentro del campo", () => {
    expect(parseCsv('nombre,nota\n"Pérez, Ana","dijo ""hola""\nluego"')).toEqual([
      ["nombre", "nota"],
      ["Pérez, Ana", 'dijo "hola"\nluego'],
    ]);
  });
  it("omite filas vacías y conserva celdas vacías", () => {
    expect(parseCsv("a;b;c\n\n;;\n1;;3\n", ";")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
  it("lee la última fila sin salto final", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("toCsv y parseCsv son inversos", () => {
    const rows = [
      ["a", 'b "x"', "c,d"],
      ["1", "línea\nnueva", ""],
    ];
    expect(parseCsv(toCsv(rows).replace(/^﻿/, ""))).toEqual(rows);
  });
});
