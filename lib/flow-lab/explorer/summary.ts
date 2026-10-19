// Resumen en texto del resultado del explorador (para copiar o exportar). Puro.

import { END_KIND_LABELS, type ExplorePath, type ExploreResult, type ExploreStateSummary, type ExploreTreeNode } from "./types";

function stateLines(s: ExploreStateSummary): string[] {
  const lines: string[] = [];
  lines.push(`Contacto: ${s.contactType ?? "sin tipo"}${s.tags.length > 0 ? ` · etiquetas: ${s.tags.join(", ")}` : ""}${s.subscribed ? "" : " · dado de baja"}`);
  const fields = Object.entries(s.customFields);
  if (fields.length > 0) lines.push(`Campos: ${fields.map(([k, v]) => `${k} = ${v}`).join("; ")}`);
  if (s.case) {
    lines.push(
      `Gestión: ${s.case.type ?? "Sin clasificar"}${s.case.stage ? ` · ${s.case.stage}` : ""}${s.case.category ? ` · categoría ${s.case.category}` : ""} · ${s.case.status}${s.case.assignee ? ` · responsable ${s.case.assignee}` : ""}${s.case.team ? ` · equipo ${s.case.team}` : ""}`,
    );
  } else {
    lines.push("Gestión: ninguna");
  }
  if (s.scheduled.length > 0) lines.push(`Programadas: ${s.scheduled.join("; ")}`);
  if (s.botPaused) lines.push("Bot en pausa");
  const variables = Object.entries(s.variables);
  if (variables.length > 0) lines.push(`Variables: ${variables.map(([k, v]) => `${k} = ${v}`).join("; ")}`);
  return lines;
}

const AUTHOR: Record<string, string> = { client: "Cliente", bot: "Bot", agent: "Asesor" };

export function pathText(path: ExplorePath): string {
  const out: string[] = [];
  out.push(`Camino ${path.id}: ${path.label}${path.variant.length > 0 ? ` [${path.variant.join(" y ")}]` : ""}`);
  out.push(`  Termina: ${path.end.text} (${END_KIND_LABELS[path.end.kind]})`);
  for (const m of path.messages) out.push(`  ${AUTHOR[m.author] ?? m.author}: ${m.text.replace(/\s+/g, " ").trim()}`);
  if (path.changes.length > 0) {
    out.push("  Cambios:");
    for (const c of path.changes) out.push(`    - ${c}`);
  }
  for (const line of stateLines(path.final)) out.push(`  ${line}`);
  if (path.warnings.length > 0) out.push(`  Avisos: ${path.warnings.join(" | ")}`);
  return out.join("\n");
}

function treeLines(node: ExploreTreeNode, depth: number, out: string[]): void {
  if (node.kind !== "root") {
    const tail = node.skipped ? " (sin explorar)" : node.pathId ? ` → camino ${node.pathId}` : "";
    out.push(`${"  ".repeat(depth)}- ${node.label}${tail}`);
  }
  for (const child of node.children) treeLines(child, node.kind === "root" ? depth : depth + 1, out);
}

/** El resultado completo en texto: resumen, árbol, caminos y cobertura. */
export function exploreSummaryText(result: ExploreResult): string {
  const out: string[] = [];
  const { coverage } = result;
  out.push(`Explorador de caminos: ${result.flowName}`);
  out.push(`Caminos: ${result.paths.length} · cobertura ${coverage.percent} % (${coverage.nodesReached}/${coverage.nodesTotal} nodos, ${coverage.outputsReached}/${coverage.outputsTotal} salidas de condición)`);
  if (result.profileName) out.push(`Perfil: ${result.profileName}`);
  for (const s of result.starts) out.push(`Disparador «${s.trigger}»: ${s.ok ? s.action : `no arrancó (${s.problem})`}`);
  if (result.variants.length > 0) out.push(`Variantes del estado de partida: ${result.variants.join("; ")}`);
  for (const note of result.notes) out.push(`Aviso: ${note}`);

  out.push("", "Árbol de decisiones");
  treeLines(result.tree, 0, out);

  out.push("", "Cómo termina cada camino");
  const counts = new Map<string, number>();
  for (const p of result.paths) counts.set(p.end.kind, (counts.get(p.end.kind) ?? 0) + 1);
  for (const [kind, n] of counts) out.push(`- ${END_KIND_LABELS[kind as keyof typeof END_KIND_LABELS]}: ${n}`);

  out.push("", "Caminos");
  for (const p of result.paths) out.push(pathText(p), "");

  out.push("Cobertura");
  if (coverage.complete) {
    out.push("- Todos los nodos y todas las salidas de condición se recorrieron.");
  } else {
    for (const n of coverage.unreachedNodes) out.push(`- Nodo sin recorrer: «${n.label}» (${n.kind})`);
    for (const o of coverage.unreachedOutputs) out.push(`- Salida sin recorrer: ${o.description}`);
  }
  return out.join("\n").trimEnd();
}
