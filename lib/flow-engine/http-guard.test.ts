import { describe, expect, it } from "vitest";
import { checkHttpTarget, isBlockedIp, readTextCapped } from "./http-guard";
import { interpolateVariables } from "./interpolate";

const resolveTo = (...addresses: string[]) => async () => addresses;

describe("isBlockedIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1"])(
    "bloquea %s",
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"])("permite %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("checkHttpTarget", () => {
  it("acepta https hacia un host público", async () => {
    const r = await checkHttpTarget("https://api.ejemplo.com/pedido?id=1", resolveTo("93.184.216.34"));
    expect(r.ok).toBe(true);
  });
  it("rechaza http, usuario y contraseña, localhost y nombres sin punto", async () => {
    for (const url of ["http://api.ejemplo.com", "https://user:pass@api.ejemplo.com", "https://localhost/x", "https://servidor/x", "https://algo.internal/x", "ftp://x.com", "no es una url"]) {
      expect((await checkHttpTarget(url, resolveTo("93.184.216.34"))).ok).toBe(false);
    }
  });
  it("rechaza IPs internas escritas de cualquier forma", async () => {
    for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://0x7f.0.0.1/", "https://169.254.169.254/latest"]) {
      expect((await checkHttpTarget(url, resolveTo("93.184.216.34"))).ok).toBe(false);
    }
  });
  it("rechaza un nombre público que resuelve a una IP interna (o a una mezcla)", async () => {
    expect((await checkHttpTarget("https://malo.ejemplo.com", resolveTo("10.0.0.7"))).ok).toBe(false);
    expect((await checkHttpTarget("https://malo.ejemplo.com", resolveTo("93.184.216.34", "127.0.0.1"))).ok).toBe(false);
  });
  it("si el DNS falla, no llama", async () => {
    const r = await checkHttpTarget("https://x.ejemplo.com", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(r.ok).toBe(false);
  });
});

describe("readTextCapped", () => {
  it("corta la respuesta en el tamaño máximo", async () => {
    const res = new Response("a".repeat(5000));
    expect((await readTextCapped(res, 1000)).length).toBe(1000);
  });
  it("lee una respuesta pequeña completa", async () => {
    expect(await readTextCapped(new Response('{"ok":true}'))).toBe('{"ok":true}');
  });
});

describe("interpolateVariables: codificación y variables desconocidas", () => {
  const vars = { message: 'dijo "hola"\ny\\adiós & más', n: 5 };
  it("json: el valor cabe dentro de un texto JSON", () => {
    const body = interpolateVariables('{"t":"{{message}}","n":{{n}}}', vars, { encode: "json" });
    expect(JSON.parse(body)).toEqual({ t: 'dijo "hola"\ny\\adiós & más', n: 5 });
  });
  it("url: el valor no puede agregar parámetros", () => {
    expect(interpolateVariables("https://x.com/?q={{message}}", { message: "a&b=1#c" }, { encode: "url" })).toBe("https://x.com/?q=a%26b%3D1%23c");
  });
  it("sin opciones deja la variable desconocida tal cual; con blankUnknown la vacía", () => {
    expect(interpolateVariables("Hola {{x}}", {})).toBe("Hola {{x}}");
    expect(interpolateVariables("Hola {{x}}", {}, { blankUnknown: true })).toBe("Hola");
    expect(interpolateVariables("Hola {{x}}", { x: "" }, { blankUnknown: true })).toBe("Hola");
    // Sin nombre el saludo queda bien escrito: sin espacio doble, ni antes de la coma o el signo.
    const sinNombre = { nombre: "" };
    expect(interpolateVariables("Hola {{nombre}}, ¿en qué te ayudo?", sinNombre, { blankUnknown: true })).toBe("Hola, ¿en qué te ayudo?");
    expect(interpolateVariables("Hola {{nombre}}!", sinNombre, { blankUnknown: true })).toBe("Hola!");
    expect(interpolateVariables("¡Hola {{nombre}} bienvenido!", sinNombre, { blankUnknown: true })).toBe("¡Hola bienvenido!");
    expect(interpolateVariables("Hola {{nombre}}, ¿en qué te ayudo?", { nombre: "Ana" }, { blankUnknown: true })).toBe("Hola Ana, ¿en qué te ayudo?");
  });
});
