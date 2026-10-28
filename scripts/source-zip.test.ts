import { describe, expect, it } from "vitest";
import { parseGitignore, shouldInclude } from "./source-zip.mjs";

const rules = parseGitignore(["/node_modules", "/.next/", ".env", ".env*.local", "*.pem", "/public/spell-worker.js", "# x", ""].join("\n"));

describe("shouldInclude", () => {
  it("excluye secretos y carpetas generadas", () => {
    for (const p of [".env", ".env.local", ".env.production", "app/.env", "node_modules/a/index.js", ".next/server/x.js", ".source-zip/codigo-crm.zip", ".git/config", ".vercel/project.json", "x/debug.log", "public/spell-worker.js", "public/dictionaries/es.dic", "certs/a.pem"]) {
      expect(shouldInclude(p, rules), p).toBe(false);
    }
  });

  it("incluye el código y .env.example", () => {
    for (const p of [".env.example", "package.json", "app/api/v1/admin/source-zip/route.ts", "supabase/migrations/00001_initial_schema.sql", "public/logo.png", "docs/PLAN-CRM.md"]) {
      expect(shouldInclude(p, rules), p).toBe(true);
    }
  });

  it("respeta los patrones del .gitignore", () => {
    const r = parseGitignore("/build\n*.tmp\nsecret-dir/\n");
    expect(shouldInclude("build/a.js", r)).toBe(false);
    expect(shouldInclude("src/build/a.js", r)).toBe(true);
    expect(shouldInclude("a/b/c.tmp", r)).toBe(false);
    expect(shouldInclude("secret-dir/x.ts", r)).toBe(false);
  });
});
