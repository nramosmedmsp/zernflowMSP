// Arma el ZIP con el código fuente de la app (botón «Código de la app» en
// Configuración). Lo usan scripts/build-source-zip.mjs (en `npm run build`) y,
// en desarrollo, la ruta app/api/v1/admin/source-zip. Nunca incluye claves:
// ningún archivo `.env*` salvo `.env.example`, y se respetan los patrones del
// .gitignore. Sin dependencias de la app: solo `fflate`.

import { execSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";

export const ZIP_ROOT = "crm-muscle-shop";
export const README_NAME = "LEEME-PARA-CLAUDE.md";
/** Archivos más grandes que esto no entran (binarios, volcados). */
export const MAX_FILE_BYTES = 1024 * 1024;

const EXCLUDED_DIRS = new Set([
  "node_modules", ".next", ".source-zip", ".git", ".vercel", "coverage", ".turbo", "out",
]);
const EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "public/spell-worker.js", ".claude/settings.local.json"]);
const EXCLUDED_PREFIXES = ["public/dictionaries/"];

/** Convierte un patrón de .gitignore en una regla {re, dirOnly, negate}. */
function compilePattern(raw) {
  let p = raw.trim();
  if (!p || p.startsWith("#")) return null;
  let negate = false;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  }
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/") || p.includes("/");
  p = p.replace(/^\//, "");
  let body = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          body += "(?:.*/)?";
        } else body += ".*";
      } else body += "[^/]*";
    } else if (c === "?") body += "[^/]";
    else body += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}$`);
  return { re, dirOnly, negate };
}

/** Reglas de un .gitignore (texto). */
export function parseGitignore(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(compilePattern)
    .filter(Boolean);
}

function ignoredByRules(relPath, isDir, rules) {
  // Un directorio ignorado ignora todo lo que tiene dentro: se prueba cada tramo.
  const parts = relPath.split("/");
  let ignored = false;
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join("/");
    const subIsDir = i < parts.length || isDir;
    for (const r of rules) {
      if (r.dirOnly && !subIsDir) continue;
      if (r.re.test(sub)) ignored = !r.negate;
    }
    if (ignored && i < parts.length) return true;
  }
  return ignored;
}

/**
 * ¿Entra este archivo (ruta relativa con «/») al ZIP? Función pura.
 * Los `.env*` quedan fuera siempre, salvo `.env.example`.
 */
export function shouldInclude(relPath, rules = []) {
  const path = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path) return false;
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => EXCLUDED_DIRS.has(d))) return false;
  if (EXCLUDED_DIRS.has(name)) return false;
  if (name.startsWith(".env") && name !== ".env.example") return false;
  if (EXCLUDED_FILES.has(path) || EXCLUDED_FILES.has(name)) return false;
  if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return false;
  if (/\.(log|pem|key|tsbuildinfo)$/i.test(name)) return false;
  if (ignoredByRules(path, false, rules)) return false;
  return true;
}

function walk(rootDir, rules) {
  const out = [];
  function visit(rel) {
    const abs = rel ? join(rootDir, rel) : rootDir;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (ignoredByRules(childRel, true, rules)) continue;
        visit(childRel);
      } else if (entry.isFile() && shouldInclude(childRel, rules)) {
        if (lstatSync(join(rootDir, childRel)).size <= MAX_FILE_BYTES) out.push(childRel);
      }
    }
  }
  visit("");
  return out.sort();
}

/** Commit del código: variable de Vercel, o git si existe, o «desconocido». */
export function currentCommit(rootDir) {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "desconocido";
  } catch {
    return "desconocido";
  }
}

const DOC_NOTES = {
  "PLAN-CRM.md": "Plan general del CRM (versión 2): qué es, qué se construye, qué no y en qué orden. Empieza aquí.",
  "FASE-1-TECNICO.md": "Fase 1: bandeja con gestiones, equipos, permisos y reparto (cómo está hecho).",
  "FASE-2-TECNICO.md": "Fase 2: automatización, horarios, importación de contactos y preparación del gimnasio.",
  "FASE-3-TECNICO.md": "Fase 3: métricas (consultas con RLS, embudo, cumplimiento, exportación).",
  "PLAN-BANDEJA-CHAT.md": "Plan de la pantalla de chat de la Bandeja, comparada con otros CRM.",
};

function docList(rootDir) {
  let files = [];
  try {
    files = readdirSync(join(rootDir, "docs")).filter((f) => f.endsWith(".md")).sort();
  } catch {
    /* sin docs */
  }
  if (files.length === 0) return "(no hay carpeta docs)";
  return files.map((f) => `- \`docs/${f}\`: ${DOC_NOTES[f] ?? "Documento del proyecto."}`).join("\n");
}

/** Texto de LEEME-PARA-CLAUDE.md. */
export function buildReadme({ rootDir, commit, date, fileCount }) {
  return `# CRM Muscle Shop: guía del código para Claude

Generado el ${date} · commit \`${commit}\` · ${fileCount} archivos.

## Qué es esta app

CRM de Muscle Shop (fork de ZernFlow) para atender clientes por WhatsApp e Instagram (también Facebook,
Telegram, X, Bluesky y Reddit). Está hecho con **Next.js 16 (App Router)**, React 19, Tailwind 4 y
TypeScript; los datos viven en **Supabase** (Postgres con RLS y Auth) y la conexión con las redes la hace
**Zernio** (SDK \`@zernio/node\`). Se despliega en **Vercel**. Toda la interfaz está en español.

Conceptos: **Bandeja** (conversaciones), **gestiones** (casos con etapas, responsable y tiempos),
**equipos/sedes**, **horarios de atención**, **flujos** automáticos, **difusiones**, **secuencias** y **métricas**.

## Dónde está cada cosa

| Tema | Ruta |
|---|---|
| Bandeja (pantalla) | \`app/(dashboard)/dashboard/inbox\` y \`components/inbox\` (corrector ortográfico en \`components/inbox/spell\`) |
| Gestiones (reglas y acciones) | \`lib/cases\`, \`lib/actions/cases.ts\`, \`lib/actions/case-config.ts\`; pantalla en \`components/cases\` |
| Flujos automáticos (motor) | \`lib/flow-engine\` |
| Constructor visual de flujos | \`components/flow-builder\` y \`app/(dashboard)/dashboard/flows\` |
| Webhook de Zernio (mensajes entrantes) | \`app/api/webhooks/late\` |
| Tareas programadas (cron) | \`app/api/cron\` (configuradas en \`vercel.json\`) |
| API pública v1 | \`app/api/v1\` |
| Configuración (equipo, correo, horarios...) | \`app/(dashboard)/dashboard/settings\` y \`components/settings\` |
| Permisos y roles | \`lib/permissions.ts\`, \`lib/team-rules.ts\` |
| Métricas | \`lib/metrics\` y \`app/(dashboard)/dashboard/metrics\` |
| Correo saliente | \`lib/mail\` |
| Clientes de Supabase | \`lib/supabase\` (la sesión se renueva en \`middleware.ts\`) |
| Migraciones SQL (en orden) | \`supabase/migrations\` (pruebas SQL en \`supabase/tests\`) |
| Scripts | \`scripts\` (datos de prueba, crear admin, corrector) |

Documentos en \`docs/\`:

${docList(rootDir)}

Fuera de \`docs/\`: \`README.md\` es el de ZernFlow original; \`LEEME-MUSCLESHOP.md\` explica la instalación
de Muscle Shop (marca, usuarios, correo, despliegue).

## Qué NO viene en este ZIP

- Claves ni variables reales: ningún \`.env\` (solo \`.env.example\`, con valores de ejemplo). No hay datos de clientes.
- \`node_modules\`, \`.next\` y archivos generados.
- \`public/dictionaries/\` (diccionarios del corrector, datos pesados) y \`public/spell-worker.js\` (se genera con \`scripts/build-spell-worker.mjs\`).
- Archivos de más de 1 MB.

## Cómo correrlo en local

1. \`npm install\`
2. Copia \`.env.example\` a \`.env.local\` y completa: \`NEXT_PUBLIC_SUPABASE_URL\`, \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`,
   \`SUPABASE_SERVICE_ROLE_KEY\`, \`CRON_SECRET\`, \`NEXT_PUBLIC_APP_URL\` y la marca (\`NEXT_PUBLIC_APP_NAME\`...).
   La clave de Zernio y la de IA se guardan dentro de la app (Configuración).
3. Aplica las migraciones de \`supabase/migrations\` a un proyecto de Supabase.
4. \`npm run dev\` (abre http://localhost:3000). Pruebas: \`npm test\`. Tipos: \`npx tsc --noEmit\`.

## Primer mensaje sugerido para Claude

> Lee LEEME-PARA-CLAUDE.md y docs/PLAN-CRM.md y explícame, en palabras simples, qué hace esta app, cómo
> fluye un mensaje de WhatsApp desde el webhook hasta la Bandeja y qué partes serían más riesgosas de cambiar.
`;
}

/**
 * Arma el ZIP en memoria. Devuelve { data, fileCount, commit, date }.
 * Los archivos van bajo la carpeta \`crm-muscle-shop/\`.
 */
export function buildSourceZip(rootDir) {
  let rules = [];
  try {
    rules = parseGitignore(readFileSync(join(rootDir, ".gitignore"), "utf8"));
  } catch {
    /* sin .gitignore */
  }
  const files = walk(rootDir, rules);
  const date = new Date().toISOString().slice(0, 10);
  const commit = currentCommit(rootDir);
  const entries = {};
  for (const rel of files) entries[`${ZIP_ROOT}/${rel}`] = [readFileSync(join(rootDir, rel)), { level: 6 }];
  const readme = buildReadme({ rootDir, commit, date, fileCount: files.length + 1 });
  entries[`${ZIP_ROOT}/${README_NAME}`] = [new TextEncoder().encode(readme), { level: 6 }];
  return { data: zipSync(entries), fileCount: files.length + 1, commit, date };
}
