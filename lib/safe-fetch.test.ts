import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REDIRECTS, fetchInboundSafely } from "./safe-fetch";

type Hop = { status: number; location?: string; body?: string };

/** fetch falso: una tabla url -> respuesta; anota cada petición. */
function fakeFetch(table: Record<string, Hop>) {
  const calls: Array<{ url: string; auth: string | null; redirect: string | undefined }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization"), redirect: init?.redirect });
    const hop = table[url];
    if (!hop) return new Response("no encontrado", { status: 404 });
    return new Response(hop.body ?? "ok", { status: hop.status, headers: hop.location ? { location: hop.location } : {} });
  }) as typeof fetch;
  return { impl, calls };
}

const KEY = "zk_clave";

describe("fetchInboundSafely", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("sin redirección: una sola petición con redirect manual y la clave si es de Zernio", async () => {
    const { impl, calls } = fakeFetch({ "https://zernio.com/api/v1/whatsapp/media/1": { status: 200 } });
    const res = await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: KEY, fetchImpl: impl });
    expect(res?.status).toBe(200);
    expect(calls).toEqual([{ url: "https://zernio.com/api/v1/whatsapp/media/1", auth: `Bearer ${KEY}`, redirect: "manual" }]);
  });

  it("sigue una redirección a un host permitido, sin reenviar la clave a otro host", async () => {
    const { impl, calls } = fakeFetch({
      "https://zernio.com/api/v1/whatsapp/media/1": { status: 302, location: "https://scontent.xx.fbcdn.net/v/foto.jpg" },
      "https://scontent.xx.fbcdn.net/v/foto.jpg": { status: 200 },
    });
    const res = await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: KEY, fetchImpl: impl });
    expect(res?.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(calls[1].auth).toBeNull();
  });

  it("una redirección relativa dentro del mismo host conserva la clave", async () => {
    const { impl, calls } = fakeFetch({
      "https://zernio.com/api/v1/whatsapp/media/1": { status: 301, location: "/api/v1/whatsapp/media/2" },
      "https://zernio.com/api/v1/whatsapp/media/2": { status: 200 },
    });
    expect((await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: KEY, fetchImpl: impl }))?.status).toBe(200);
    expect(calls.map((c) => c.auth)).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`]);
  });

  it.each([
    ["host que no está en la lista", "https://evil.example.com/x.jpg"],
    ["http sin cifrar", "http://zernio.com/api/v1/whatsapp/media/1"],
    ["dirección interna", "https://169.254.169.254/latest/meta-data"],
    ["localhost", "https://localhost/admin"],
    ["parecido pero no del dominio", "https://zernio.com.evil.io/x"],
  ])("corta la descarga si la redirección va a un destino no permitido (%s)", async (_label, target) => {
    const { impl, calls } = fakeFetch({ "https://zernio.com/api/v1/whatsapp/media/1": { status: 302, location: target } });
    const res = await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: KEY, fetchImpl: impl });
    expect(res).toBeNull();
    // Nunca se hizo la petición al destino ajeno.
    expect(calls.map((c) => c.url)).toEqual(["https://zernio.com/api/v1/whatsapp/media/1"]);
  });

  it("el destino ajeno nunca recibe la clave aunque se intente un doble salto", async () => {
    const { impl, calls } = fakeFetch({
      "https://zernio.com/api/v1/whatsapp/media/1": { status: 302, location: "https://cdn.instagram.com/a" },
      "https://cdn.instagram.com/a": { status: 302, location: "https://evil.example.com/robar" },
    });
    expect(await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: KEY, fetchImpl: impl })).toBeNull();
    expect(calls.every((c) => !c.url.includes("evil"))).toBe(true);
    expect(calls[1].auth).toBeNull();
  });

  it("corta un ciclo o demasiados saltos", async () => {
    const { impl, calls } = fakeFetch({
      "https://fbcdn.net/a": { status: 302, location: "https://fbcdn.net/b" },
      "https://fbcdn.net/b": { status: 302, location: "https://fbcdn.net/a" },
    });
    expect(await fetchInboundSafely("https://fbcdn.net/a", { apiKey: null, fetchImpl: impl })).toBeNull();
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("una redirección sin Location o con Location inválido corta", async () => {
    const a = fakeFetch({ "https://fbcdn.net/a": { status: 302 } });
    expect(await fetchInboundSafely("https://fbcdn.net/a", { apiKey: null, fetchImpl: a.impl })).toBeNull();
    const b = fakeFetch({ "https://fbcdn.net/a": { status: 302, location: "http://[::bad" } });
    expect(await fetchInboundSafely("https://fbcdn.net/a", { apiKey: null, fetchImpl: b.impl })).toBeNull();
  });

  it("si piden un host de Zernio y no hay clave, ni siquiera sale la petición", async () => {
    const { impl, calls } = fakeFetch({});
    expect(await fetchInboundSafely("https://zernio.com/api/v1/whatsapp/media/1", { apiKey: null, fetchImpl: impl })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("un error HTTP final (404, 500) se devuelve igual que con fetch", async () => {
    const { impl } = fakeFetch({ "https://fbcdn.net/a": { status: 404 } });
    expect((await fetchInboundSafely("https://fbcdn.net/a", { apiKey: null, fetchImpl: impl }))?.status).toBe(404);
  });
});
