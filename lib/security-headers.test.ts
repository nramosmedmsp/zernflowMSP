import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders, supabaseOrigins } from "./security-headers";

const PROD = { isDev: false, supabaseUrl: "https://irdpastleqrpszzcqgpn.supabase.co" };

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ") ?? [];

describe("supabaseOrigins", () => {
  it("https: peticiones https y Realtime wss", () => {
    expect(supabaseOrigins("https://abc.supabase.co")).toEqual({ http: "https://abc.supabase.co", ws: "wss://abc.supabase.co" });
  });
  it("http local: ws con el mismo host y puerto", () => {
    expect(supabaseOrigins("http://127.0.0.1:54321")).toEqual({ http: "http://127.0.0.1:54321", ws: "ws://127.0.0.1:54321" });
  });
  it("sin URL o URL rota: comodín de proyectos supabase.co", () => {
    for (const bad of [undefined, null, "", "no es url", "ftp://x"]) {
      expect(supabaseOrigins(bad)).toEqual({ http: "https://*.supabase.co", ws: "wss://*.supabase.co" });
    }
  });
});

describe("buildCsp en producción", () => {
  const csp = buildCsp(PROD);

  it("scripts solo de la propia app (sin eval, sin orígenes externos)", () => {
    expect(directive(csp, "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp).not.toContain("unsafe-eval");
  });

  it("conexiones a la app y a Supabase por https y wss, nada más", () => {
    expect(directive(csp, "connect-src")).toEqual(["'self'", "https://irdpastleqrpszzcqgpn.supabase.co", "wss://irdpastleqrpszzcqgpn.supabase.co"]);
  });

  it("imágenes y medios de Zernio/Meta/Supabase (https), vistas previas locales (blob) y data", () => {
    for (const name of ["img-src", "media-src"]) {
      const values = directive(csp, name);
      expect(values).toEqual(expect.arrayContaining(["'self'", "blob:", "https:"]));
      expect(values).not.toContain("http:");
      expect(values).not.toContain("*");
    }
    expect(directive(csp, "img-src")).toContain("data:");
  });

  it("cierra objetos, base, formularios, marcos y workers a lo propio", () => {
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "worker-src")).toEqual(["'self'", "blob:"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("fuentes solo de la propia app y sin ninguna fuente externa de Google", () => {
    expect(directive(csp, "font-src")).toEqual(["'self'", "data:"]);
    expect(csp).not.toContain("googleapis");
  });

  it("sube a https las peticiones inseguras", () => {
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("no usa comodines peligrosos en script-src/connect-src", () => {
    for (const name of ["script-src", "connect-src", "default-src", "object-src"]) {
      expect(directive(csp, name)).not.toContain("*");
      expect(directive(csp, name)).not.toContain("https:");
      expect(directive(csp, name)).not.toContain("data:");
    }
  });
});

describe("buildCsp en desarrollo y con Supabase local", () => {
  const csp = buildCsp({ isDev: true, supabaseUrl: "http://127.0.0.1:54321" });

  it("permite eval (React en desarrollo) y la recarga en caliente", () => {
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toEqual(expect.arrayContaining(["ws://127.0.0.1:54321", "http://127.0.0.1:54321", "ws://localhost:*"]));
  });

  it("permite ver imágenes y medios firmados de Supabase local por http", () => {
    expect(directive(csp, "img-src")).toContain("http://127.0.0.1:54321");
    expect(directive(csp, "media-src")).toContain("http://127.0.0.1:54321");
  });

  it("no sube a https (rompería Supabase local)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ isDev: false, supabaseUrl: "http://127.0.0.1:54321" })).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  const headers = Object.fromEntries(securityHeaders(PROD).map((h) => [h.key, h.value]));

  it("incluye las cabeceras estándar", () => {
    expect(headers["Content-Security-Policy"]).toBe(buildCsp(PROD));
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(headers["X-Permitted-Cross-Domain-Policies"]).toBe("none");
    expect(headers["Permissions-Policy"]).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });

  it("no repite cabeceras y ninguna lleva saltos de línea", () => {
    const list = securityHeaders(PROD);
    expect(new Set(list.map((h) => h.key)).size).toBe(list.length);
    for (const h of list) expect(h.value).not.toMatch(/[\r\n]/);
  });
});
