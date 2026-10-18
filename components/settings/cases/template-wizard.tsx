"use client";

import { useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { applyBusinessTemplate } from "@/lib/actions/cases";
import { cn } from "@/lib/utils";
import { STAGE_KIND_LABELS } from "./config-rules";
import type { TemplateSummary } from "./template-summary";
import { KIND_BADGE, Modal, NoticeBox, primaryButtonClass, secondaryButtonClass, useRunner } from "./shared";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Tarjeta de una plantilla: descripción breve y, desplegable, todo su contenido. */
function TemplateCard({
  template,
  selected,
  onSelect,
  action,
}: {
  template: TemplateSummary;
  selected?: boolean;
  onSelect?: () => void;
  action?: React.ReactNode;
}) {
  const empty = template.caseTypes.length === 0 && template.contactTypes.length === 0;
  const stageCount = template.caseTypes.reduce((n, t) => n + t.stages.length, 0);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card p-4 transition-colors",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
        onSelect && "cursor-pointer hover:border-primary/60",
      )}
      onClick={onSelect}
      role={onSelect ? "radio" : undefined}
      aria-checked={onSelect ? selected : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <h3 className="text-base font-semibold">{template.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>

      {!empty && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {plural(template.caseTypes.length, "tipo de gestión", "tipos de gestión")} · {plural(stageCount, "etapa", "etapas")} ·{" "}
            {plural(template.contactTypes.length, "tipo de contacto", "tipos de contacto")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {template.caseTypes.map((t) => (
              <span key={t.name} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
                {t.isProactive && <span className="text-muted-foreground">(proactiva)</span>}
              </span>
            ))}
          </div>

          <details className="mt-3 text-xs" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer font-medium text-primary">Ver contenido</summary>
            <div className="mt-2 space-y-3">
              <p>
                <span className="font-medium">Tipos de contacto:</span> {template.contactTypes.join(", ")}
              </p>
              {template.caseTypes.map((t) => (
                <div key={t.name} className="space-y-1 border-l-2 pl-3" style={{ borderColor: t.color }}>
                  <p className="font-medium">{t.name}</p>
                  <p className="flex flex-wrap items-center gap-1">
                    {t.stages.map((s) => (
                      <span key={s.name} className={cn("rounded-full px-2 py-0.5", s.kind === "open" ? "bg-muted" : KIND_BADGE[s.kind])} title={STAGE_KIND_LABELS[s.kind]}>
                        {s.name}
                      </span>
                    ))}
                  </p>
                  {t.categories.length > 0 && <p className="text-muted-foreground">Categorías: {t.categories.join(", ")}</p>}
                  {t.reasons.length > 0 && <p className="text-muted-foreground">Motivos: {t.reasons.join(", ")}</p>}
                  {t.rules > 0 && <p className="text-muted-foreground">{plural(t.rules, "regla", "reglas")} precargadas</p>}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {empty && <p className="mt-3 text-xs text-muted-foreground">No agrega nada: podrás crear tus propios tipos, etapas y motivos.</p>}

      {action && <div className="mt-4 pt-1">{action}</div>}
    </div>
  );
}

/** Aplica una plantilla y muestra qué se agregó. Devuelve true si se aplicó. */
function useApplyTemplate() {
  const { run, busy, notice, clearNotice } = useRunner();
  const apply = (template: TemplateSummary) =>
    run(
      () => applyBusinessTemplate(template.key),
      (r) => {
        const a = r.result.added;
        const total = a.contactTypes + a.caseTypes + a.stages + a.categories + a.reasons + a.rules;
        return total === 0
          ? `La plantilla ${template.name} no tenía nada nuevo que agregar.`
          : `Plantilla ${template.name} aplicada: se agregaron ${plural(a.caseTypes, "tipo de gestión", "tipos de gestión")}, ${plural(a.stages, "etapa", "etapas")}, ${plural(a.categories, "categoría", "categorías")}, ${plural(a.reasons, "motivo", "motivos")}, ${plural(a.rules, "regla", "reglas")} y ${plural(a.contactTypes, "tipo de contacto", "tipos de contacto")}.`;
      },
    );
  return { apply, busy, notice, clearNotice };
}

/** Asistente de inicio: se muestra cuando el espacio todavía no tiene tipos de gestión. */
export function TemplateWizard({ templates }: { templates: TemplateSummary[] }) {
  const { apply, busy, notice, clearNotice } = useApplyTemplate();
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-8 py-8">
      <div>
        <h2 className="text-lg font-semibold">¿Qué tipo de negocio es?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige una plantilla para precargar los tipos de gestión, etapas, motivos y reglas. Después puedes cambiar todo en esta misma pantalla, y siempre puedes agregar lo que falte de otra plantilla.
        </p>
      </div>

      {notice && <NoticeBox notice={notice} onClose={clearNotice} />}

      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <TemplateCard
            key={t.key}
            template={t}
            action={
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChosen(t.key);
                  apply(t);
                }}
                className={primaryButtonClass}
              >
                {busy && chosen === t.key && <Loader2 className="h-4 w-4 animate-spin" />}
                Usar {t.name}
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}

/** «Agregar desde plantilla»: suma lo que falte de otra plantilla, sin borrar nada. */
export function AddTemplateDialog({ open, onClose, templates }: { open: boolean; onClose: () => void; templates: TemplateSummary[] }) {
  const { apply, busy, notice, clearNotice } = useApplyTemplate();
  const [selected, setSelected] = useState<string | null>(null);
  const template = templates.find((t) => t.key === selected) ?? null;

  function close() {
    clearNotice();
    setSelected(null);
    onClose();
  }

  return (
    <Modal open={open} title="Agregar desde plantilla" onClose={close} wide>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Solo agrega lo que falte (tipos de contacto, tipos de gestión, etapas, categorías, motivos y reglas, comparando por nombre). Nunca borra ni reemplaza nada de lo que ya tienes.
        </p>

        {notice && <NoticeBox notice={notice} onClose={clearNotice} />}

        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plantilla">
          {templates
            .filter((t) => t.caseTypes.length > 0 || t.contactTypes.length > 0)
            .map((t) => (
              <TemplateCard key={t.key} template={t} selected={selected === t.key} onSelect={() => setSelected(t.key)} />
            ))}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={close}>
            Cerrar
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !template}
            onClick={() => template && apply(template)}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {template ? `Agregar lo que falte de ${template.name}` : "Elige una plantilla"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
