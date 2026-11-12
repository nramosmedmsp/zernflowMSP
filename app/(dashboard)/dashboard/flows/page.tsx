import { getWorkspace } from "@/lib/workspace";
import Link from "next/link";
import { GitBranch, Sparkles, Plug, FlaskConical, ListChecks, Network, TriangleAlert } from "lucide-react";
import { CreateFlowButton } from "@/components/create-flow-button";
import { ImportFlowButton, ExportFlowButton, DeleteFlowButton } from "@/components/flow-actions";
import type { FlowStatus } from "@/lib/types/database";
import { formatDateTime } from "@/lib/format";
import { brokenBadgeText, brokenDetailLines, brokenNodeCount, findBrokenNodes, type BrokenNode } from "@/lib/flow-engine/broken-nodes";
import { loadFlowCatalog } from "@/lib/flow-engine/broken-nodes-catalog";

const statusConfig: Record<FlowStatus, { label: string; classes: string }> = {
  draft: {
    label: "Borrador",
    classes:
      "bg-muted text-muted-foreground",
  },
  published: {
    label: "Publicado",
    classes:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  archived: {
    label: "Archivado",
    classes:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};


export default async function FlowsPage() {
  const { workspace, supabase } = await getWorkspace();

  const [{ data: flows }, { count: channelCount }] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name, description, status, updated_at, version, nodes, edges")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("channels")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
  ]);

  // R2-5: nodos que usan algo archivado o borrado (etapa, tipo, equipo...).
  // Si no se pudo leer el catálogo no se avisa nada, para no dar falsas alarmas.
  const catalog = await loadFlowCatalog(supabase);
  const brokenByFlow = new Map<string, BrokenNode[]>();
  if (catalog) {
    for (const flow of flows ?? []) {
      if (flow.status === "archived") continue;
      const broken = findBrokenNodes(Array.isArray(flow.nodes) ? (flow.nodes as unknown as Parameters<typeof findBrokenNodes>[0]) : [], catalog);
      if (broken.length > 0) brokenByFlow.set(flow.id, broken);
    }
  }
  const brokenPublished = (flows ?? []).filter((f) => f.status === "published" && brokenByFlow.has(f.id));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div>
            <h1 className="text-2xl font-bold">Flujos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Crea flujos automáticos de chatbot para tus canales
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
            <ImportFlowButton />
            <Link
              href="/dashboard/flows/lab"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <FlaskConical className="h-4 w-4" />
              Laboratorio
            </Link>
            <Link
              href="/dashboard/flows/scenarios"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ListChecks className="h-4 w-4" />
              Escenarios
            </Link>
            <Link
              href="/dashboard/flows/map"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Network className="h-4 w-4" />
              Mapa
            </Link>
            <Link
              href="/dashboard/flows/templates"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Plantillas
            </Link>
            <CreateFlowButton />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
      {brokenPublished.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">
              {brokenPublished.length === 1
                ? "Un flujo publicado tiene nodos rotos"
                : `${brokenPublished.length} flujos publicados tienen nodos rotos`}
            </p>
            <p className="mt-0.5 text-xs">
              Usan una etapa, un tipo de gestión, un equipo o un tipo de contacto que se archivó o se borró, así que esos pasos
              fallan en silencio. Ábrelos y elige otra opción:{" "}
              {brokenPublished.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ", "}
                  <Link href={`/dashboard/flows/${f.id}`} className="font-medium underline underline-offset-2">
                    {f.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      )}
      {(channelCount ?? 0) === 0 && (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-dashed border-border bg-card p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Conecta un canal para empezar</p>
            <p className="text-xs text-muted-foreground">
              Vincula tus redes sociales para que tus flujos puedan enviar y recibir mensajes.
            </p>
          </div>
          <Link
            href="/dashboard/channels"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Conectar
          </Link>
        </div>
      )}

      {!flows || flows.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Aún no hay flujos</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Crea tu primer flujo para empezar a automatizar conversaciones.
          </p>
          <div className="mt-4">
            <CreateFlowButton />
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => {
            const status = statusConfig[flow.status as FlowStatus] ?? statusConfig.draft;
            const nodeCount = Array.isArray(flow.nodes) ? flow.nodes.length : 0;
            const broken = brokenByFlow.get(flow.id) ?? [];
            const brokenDetail = brokenDetailLines(broken).join("\n");

            return (
              <Link
                key={flow.id}
                href={`/dashboard/flows/${flow.id}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium group-hover:text-primary transition-colors">
                          {flow.name}
                        </h3>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {nodeCount} {nodeCount === 1 ? "nodo" : "nodos"}
                      </p>
                      {broken.length > 0 && (
                        <span
                          title={brokenDetail}
                          aria-label={`${brokenBadgeText(brokenNodeCount(broken))}: ${brokenDetail}`}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        >
                          <TriangleAlert className="h-3 w-3" />
                          {brokenBadgeText(brokenNodeCount(broken))}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ExportFlowButton flow={flow} />
                    <DeleteFlowButton flow={flow} />
                  </div>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Actualizado {formatDateTime(flow.updated_at)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
