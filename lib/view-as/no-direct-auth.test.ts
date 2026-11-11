// Red de seguridad de "Ver como": el código no debe leer la identidad de Auth
// directamente, porque con una vista activa la identidad que cuenta es otra.
// Quien necesite saber "quién es" debe usar getWorkspace(), los guardas de
// lib/api-auth.ts o getEffectiveUser()/getEffectiveAuthUser() de view-as/state.ts.
// Si esta prueba falla, la llamada nueva probablemente debe pasar por esos
// ayudantes (o, si de verdad necesita a la persona REAL, añadirse a la lista
// con una justificación).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "components"];
const SCAN_FILES = ["middleware.ts"];

/** Archivos donde SÍ se lee Auth directamente, y por qué. */
const AUTH_ALLOWED: Record<string, string> = {
  "lib/view-as/state.ts": "implementa la identidad real y la efectiva (getClaims y getUser)",
  "lib/supabase/middleware.ts": "middleware: renueva la sesión y decide redirigir a /login con la persona real",
};

/** Archivos que pueden usar el cliente de servicio SIN candado de solo lectura. */
const RAW_ALLOWED: Record<string, string> = {
  "lib/supabase/server.ts": "lo define",
  "lib/actions/cases.ts": "authIdentity (unstable_cache no puede leer cookies; solo lee nombre y correo)",
};
const RAW_ALLOWED_PREFIXES = ["lib/view-as/", "app/api/v1/view-as/", "app/(dashboard)/dashboard/settings/view-as/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".test-helper.ts")) out.push(full);
  }
  return out;
}

function sourceFiles(): { rel: string; text: string }[] {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).concat(SCAN_FILES.map((f) => join(ROOT, f)));
  return files.map((f) => ({ rel: relative(ROOT, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));
}

/** Quita comentarios para no confundir una mención con una llamada. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Ver como: nadie lee la identidad de Auth por su cuenta", () => {
  const files = sourceFiles();

  it("hay archivos que revisar", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it(".auth.getUser( y .auth.getClaims( solo en la lista permitida", () => {
    const offenders = files
      .filter((f) => /\.auth\.(getUser|getClaims)\(/.test(stripComments(f.text)))
      .map((f) => f.rel)
      .filter((rel) => !(rel in AUTH_ALLOWED));
    expect(offenders).toEqual([]);
  });

  it("la lista permitida no tiene entradas muertas", () => {
    for (const rel of Object.keys(AUTH_ALLOWED)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} ya no existe`).toBeTruthy();
      expect(/\.auth\.(getUser|getClaims)\(/.test(stripComments(f!.text)), `${rel} ya no llama a Auth`).toBe(true);
    }
  });

  it("createRawServiceClient (sin candado) solo donde está justificado", () => {
    const offenders = files
      .filter((f) => /createRawServiceClient\s*\(/.test(stripComments(f.text)))
      .map((f) => f.rel)
      .filter((rel) => !(rel in RAW_ALLOWED) && !RAW_ALLOWED_PREFIXES.some((p) => rel.startsWith(p)));
    expect(offenders).toEqual([]);
  });

  it("nadie crea clientes de Supabase del servidor por su cuenta (se saltarían el candado)", () => {
    const offenders = files
      .filter((f) => /\bcreateServerClient\s*[<(]/.test(stripComments(f.text)))
      .map((f) => f.rel)
      .filter((rel) => rel !== "lib/supabase/server.ts" && rel !== "lib/supabase/middleware.ts" && rel !== "lib/supabase/client.ts");
    expect(offenders).toEqual([]);
  });
});
