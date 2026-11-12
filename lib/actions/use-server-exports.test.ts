import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next.js solo deja exportar funciones async desde un archivo "use server".
// Un `export const` suelto (por ejemplo un mensaje) rompe la compilación y deja
// sin abrir las pantallas que importan ese archivo (pasó con contact-privacy.ts).
const DIR = __dirname;

describe('archivos "use server" de lib/actions', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it.each(files)("%s solo exporta funciones async y tipos", (file) => {
    const source = readFileSync(join(DIR, file), "utf8");
    if (!/^\s*["']use server["']/.test(source)) return;
    const bad = source
      .split("\n")
      .filter((line) => /^export\s+(const|let|var|function|class|enum|default)\b/.test(line))
      .filter((line) => !/^export\s+(async\s+function)\b/.test(line));
    expect(bad).toEqual([]);
  });
});
