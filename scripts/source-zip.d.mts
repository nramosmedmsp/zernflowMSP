// Tipos de scripts/source-zip.mjs (para la ruta y las pruebas en TypeScript).

export interface GitignoreRule {
  re: RegExp;
  dirOnly: boolean;
  negate: boolean;
}
export const ZIP_ROOT: string;
export const README_NAME: string;
export const MAX_FILE_BYTES: number;
export function parseGitignore(text: string): GitignoreRule[];
export function shouldInclude(relPath: string, rules?: GitignoreRule[]): boolean;
export function currentCommit(rootDir: string): string;
export function buildReadme(opts: { rootDir: string; commit: string; date: string; fileCount: number }): string;
export function buildSourceZip(rootDir: string): { data: Uint8Array; fileCount: number; commit: string; date: string };
