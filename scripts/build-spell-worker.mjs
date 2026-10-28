// Empaqueta el corrector en segundo plano (components/inbox/spell/spell.worker.ts)
// en public/spell-worker.js. Turbopack no empaqueta los Web Workers: sin esto el
// navegador recibiría el archivo TypeScript sin compilar. Corre antes de
// `next dev` y de `next build` (package.json).

import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["components/inbox/spell/spell.worker.ts"],
  outfile: "public/spell-worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  // "@/lib/..." como en tsconfig.json.
  tsconfig: "tsconfig.json",
  logLevel: "warning",
});
