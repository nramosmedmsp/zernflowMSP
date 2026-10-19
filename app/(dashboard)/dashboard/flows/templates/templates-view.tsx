"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, GitBranch, Loader2, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { installFlowTemplateAction } from "@/lib/actions/flow-templates";
import { saveTemplateNotes } from "@/components/flow-builder/template-notes";
import {
  BUSINESS_FILTERS,
  BUSINESS_LABELS,
  categoriesOf,
  templatesForBusiness,
  type BusinessFilter,
  type FlowTemplateSummary,
} from "@/lib/flow-templates/catalog";

const FILTER_LABELS: Record<BusinessFilter, string> = { all: "Todas", ...BUSINESS_LABELS };

const BUSINESS_BADGE: Record<FlowTemplateSummary["business"], string> = {
  ecommerce: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  gym: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  general: "bg-muted text-muted-foreground",
};

function chipClass(active: boolean) {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

export function TemplatesView({
  templates,
  defaultBusiness,
  canInstall,
}: {
  templates: FlowTemplateSummary[];
  defaultBusiness: BusinessFilter;
  canInstall: boolean;
}) {
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessFilter>(defaultBusiness);
  const [category, setCategory] = useState<string>("all");
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  // Las plantillas de un negocio incluyen las generales; "General" solo las generales.
  const byBusiness = useMemo(() => templatesForBusiness(business, templates), [templates, business]);
  const categories = useMemo(() => categoriesOf(byBusiness), [byBusiness]);
  const visible = category === "all" ? byBusiness : byBusiness.filter((t) => t.category === category);

  function chooseBusiness(next: BusinessFilter) {
    setBusiness(next);
    setCategory("all");
  }

  async function handleUseTemplate(template: FlowTemplateSummary) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setCreating(template.id);
    setError(null);

    try {
      const result = await installFlowTemplateAction(template.id);
      if ("error" in result) {
        setError(result.error);
        pendingRef.current = false;
        setCreating(null);
        return;
      }
      saveTemplateNotes(result.flowId, {
        templateName: result.name,
        warnings: result.warnings.map((w) => ({ level: w.level, nodeLabel: w.nodeLabel, message: w.message })),
        adjust: result.adjust,
      });
      router.push(`/dashboard/flows/${result.flowId}`);
    } catch (err) {
      console.error("No se pudo crear el flujo desde la plantilla:", err);
      setError("No se pudo crear el flujo desde la plantilla. Inténtalo de nuevo.");
      pendingRef.current = false;
      setCreating(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/flows"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Flujos
        </Link>
        <h1 className="text-2xl font-bold">Plantillas de flujos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instala un ejemplo básico para tu tipo de negocio y adáptalo. Se crea como borrador: no se publica solo.
        </p>

        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por negocio">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">Negocio</span>
            {BUSINESS_FILTERS.map((b) => (
              <button key={b} type="button" onClick={() => chooseBusiness(b)} className={chipClass(business === b)}>
                {FILTER_LABELS[b]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por categoría">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">Categoría</span>
            <button type="button" onClick={() => setCategory("all")} className={chipClass(category === "all")}>
              Todas
            </button>
            {categories.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} className={chipClass(category === c)}>
                {c}
              </button>
            ))}
          </div>
          {business !== "all" && business !== "general" && (
            <p className="text-xs text-muted-foreground">Incluye las plantillas generales, que sirven para cualquier negocio.</p>
          )}
        </div>

        {!canInstall && (
          <p className="mt-3 text-xs text-muted-foreground">Solo el Dueño o un Administrador pueden instalar plantillas.</p>
        )}
        {error && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-8">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay plantillas para este filtro.</p>
        ) : (
          <div className="grid items-start gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((template) => {
              const isCreating = creating === template.id;
              return (
                <div
                  key={template.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                        BUSINESS_BADGE[template.business],
                      )}
                    >
                      {BUSINESS_LABELS[template.business]}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {template.category}
                    </span>
                  </div>

                  <h3 className="mt-4 text-sm font-semibold">{template.name}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{template.description}</p>

                  <p className="mt-4 flex items-start gap-1.5 text-xs">
                    <Zap className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span>
                      <span className="font-semibold">Se activa: </span>
                      {template.trigger}
                    </span>
                  </p>

                  <details className="mt-3 text-xs">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground">
                      <GitBranch className="h-3 w-3" />
                      {template.nodeCount} {template.nodeCount === 1 ? "paso" : "pasos"}: ver la lista
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                      {template.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </details>

                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="font-semibold">Qué tienes que ajustar</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {template.adjust.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>

                  {template.requires.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Funciona mejor con: {template.requires.map((r) => r.name).join(", ")} (publicada).
                    </p>
                  )}

                  <button
                    onClick={() => handleUseTemplate(template)}
                    disabled={!!creating || !canInstall}
                    className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isCreating ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Creando...
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5" />
                        Usar plantilla
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
