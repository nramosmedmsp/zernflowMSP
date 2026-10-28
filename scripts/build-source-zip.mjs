// Genera .source-zip/codigo-crm.zip con el código fuente (lo descarga el
// administrador desde Configuración → Código de la app). Corre antes de
// `next build` (package.json). La ruta lo lee con process.cwd().

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildSourceZip } from "./source-zip.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { data, fileCount } = buildSourceZip(root);
mkdirSync(join(root, ".source-zip"), { recursive: true });
writeFileSync(join(root, ".source-zip", "codigo-crm.zip"), data);
console.log(`[source-zip] ${fileCount} archivos, ${(data.length / 1024 / 1024).toFixed(2)} MB`);
