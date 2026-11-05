"use client";

// Editor de la guía de una etapa (Configuración → Gestiones → Etapas): el texto
// «Ahora:» que ve el asesor, los pasos siguientes que se ofrecen como botones y
// lo que la etapa pide antes de avanzar. Sin pasos, se ofrece la siguiente etapa
// abierta y todos los cierres (así un tipo funciona sin configurar nada).

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { updateItem } from "@/lib/actions/case-config";
import {
  GUIDE_TEXT_MAX,
  MAX_NEXT_STEPS,
  STAGE_REQUIREMENTS,
  STAGE_REQUIREMENT_LABELS,
  STEP_ACTIONS,
  STEP_ACTION_LABELS,
  STEP_LABEL_MAX,
  cleanGuideText,
  resolveExits,
  validateNextSteps,
  type NextStep,
} from "@/lib/cases/guide";
import type { StageRequirement } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { STAGE_KIND_LABELS, type StageConfig } from "./config-rules";
import { iconButtonClass, inputClass, primaryButtonClass, type TabProps } from "./shared";

const SOLUTION_NOTE = "Pide registrar la solución con fecha compromiso (usa el plazo de Control de reclamos).";

function sameSteps(a: readonly NextStep[], b: readonly NextStep[]): boolean {
  return JSON.stringify(a.map((s) => [s.stageId, s.action, s.label ?? null])) === JSON.stringify(b.map((s) => [s.stageId, s.action, s.label ?? null]));
}

export function StageGuideEditor({
  stage,
  type,
  run,
  busy,
}: {
  stage: StageConfig;
  type: TabProps["type"];
  run: TabProps["run"];
  busy: boolean;
}) {
  const [text, setText] = useState(stage.guideText ?? "");
  const [steps, setSteps] = useState<NextStep[]>(stage.nextSteps);
  const [requires, setRequires] = useState<StageRequirement | "">(stage.requires ?? "");
  const [error, setError] = useState<string | null>(null);

  const stages = type.stages.filter((s) => !s.archived);
  const targets = stages.filter((s) => s.id !== stage.id);
  const hasCategories = type.categories.some((c) => !c.archived);
  const dirty =
    text.trim() !== (stage.guideText ?? "") || !sameSteps(steps, stage.nextSteps) || requires !== (stage.requires ?? "");

  // Vista previa de los botones tal como los verá el asesor.
  const previewStage = { ...stage, guideText: text, nextSteps: steps, requires: requires || null };
  const preview = resolveExits(
    stages.map((s) => (s.id === stage.id ? previewStage : s)).map((s) => ({ ...s })),
    stage.id,
  );

  const used = new Set(steps.map((s) => s.stageId ?? s.action));
  const available = [
    ...targets.filter((t) => !used.has(t.id)).map((t) => ({ value: t.id, label: `${t.name} (${STAGE_KIND_LABELS[t.kind].toLowerCase()})` })),
    ...STEP_ACTIONS.filter((a) => !used.has(a)).map((a) => ({ value: a, label: STEP_ACTION_LABELS[a] })),
  ];

  function add(value: string) {
    if (!value || steps.length >= MAX_NEXT_STEPS) return;
    const isAction = (STEP_ACTIONS as readonly string[]).includes(value);
    setSteps([...steps, isAction ? { stageId: null, action: value as NextStep["action"], label: null } : { stageId: value, action: null, label: null }]);
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  }

  async function save() {
    const cleaned = cleanGuideText(text);
    if (cleaned && typeof cleaned === "object") return setError(cleaned.error);
    const checked = validateNextSteps({ stageId: stage.id, steps, stages });
    if ("error" in checked) return setError(checked.error);
    if (requires === "category" && !hasCategories) {
      return setError("Agrega al menos una categoría activa antes de pedirla en esta etapa.");
    }
    setError(null);
    await run(
      () =>
        updateItem({
          list: "stage",
          id: stage.id,
          guideText: cleaned as string | null,
          nextSteps: checked.steps,
          requires: requires || null,
        }),
      `Guía de «${stage.name}» guardada.`,
    );
  }

  const nameOf = (id: string | null) => stages.find((s) => s.id === id)?.name ?? "(etapa quitada)";

  return (
    <div className="w-full space-y-4 border-t border-border pt-3" data-testid={`guide-editor-${stage.id}`}>
      <div>
        <label htmlFor={`guide-text-${stage.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Qué hacer en esta etapa
        </label>
        <textarea
          id={`guide-text-${stage.id}`}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, GUIDE_TEXT_MAX))}
          rows={2}
          disabled={busy}
          placeholder="Ej.: Saluda y pregunta qué producto busca."
          className={cn(inputClass, "w-full resize-none")}
        />
        <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
          {text.length}/{GUIDE_TEXT_MAX}
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Pasos siguientes</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Son los botones que ve el asesor, en este orden. El primero que avanza queda destacado. Si no agregas ninguno, se ofrece la siguiente etapa y todos los cierres.
        </p>
        {steps.length > 0 && (
          <ul className="mb-2 space-y-1.5">
            {steps.map((st, i) => (
              <li key={`${st.stageId ?? st.action}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                <div className="flex flex-col">
                  <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Subir paso">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className={cn(iconButtonClass, "h-4")} disabled={busy || i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Bajar paso">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="min-w-[8rem] text-sm font-medium">
                  {st.stageId ? nameOf(st.stageId) : st.action ? STEP_ACTION_LABELS[st.action] : ""}
                </span>
                <input
                  value={st.label ?? ""}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, STEP_LABEL_MAX) || null } : x)))}
                  disabled={busy}
                  placeholder="Texto del botón (opcional)"
                  aria-label={`Texto del botón para ${st.stageId ? nameOf(st.stageId) : "la ayuda"}`}
                  className={cn(inputClass, "min-w-[10rem] flex-1 px-2 py-1 text-xs")}
                />
                <button
                  type="button"
                  className={cn(iconButtonClass, "hover:text-destructive")}
                  disabled={busy}
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  aria-label="Quitar paso"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {available.length > 0 && steps.length < MAX_NEXT_STEPS && (
          <select
            value=""
            onChange={(e) => add(e.target.value)}
            disabled={busy}
            aria-label="Agregar un paso siguiente"
            className={cn(inputClass, "w-full max-w-sm text-xs")}
          >
            <option value="">+ Agregar un paso siguiente…</option>
            {available.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label htmlFor={`guide-requires-${stage.id}`} className="mb-1 block text-xs font-medium text-muted-foreground">
          Pide
        </label>
        <select
          id={`guide-requires-${stage.id}`}
          value={requires}
          onChange={(e) => setRequires(e.target.value as StageRequirement | "")}
          disabled={busy}
          className={cn(inputClass, "w-full max-w-sm text-xs")}
        >
          <option value="">Nada en especial</option>
          {STAGE_REQUIREMENTS.map((r) => (
            <option key={r} value={r}>
              {STAGE_REQUIREMENT_LABELS[r]}
            </option>
          ))}
        </select>
        {requires === "solution" && <p className="mt-1 text-xs text-muted-foreground">{SOLUTION_NOTE}</p>}
        {requires === "category" && (
          <p className="mt-1 text-xs text-muted-foreground">El asesor no puede pasar a la siguiente etapa sin elegir la categoría.</p>
        )}
      </div>

      <div className="rounded-lg bg-muted/50 px-3 py-2">
        <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Así lo verá el asesor</p>
        <p className="text-sm">
          <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase text-primary">Ahora</span>
          {text.trim() || <span className="text-muted-foreground">Estás en «{stage.name}». Elige el siguiente paso cuando corresponda.</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preview.length === 0 && <span className="text-xs text-muted-foreground">Sin botones.</span>}
          {preview.map((e, i) => (
            <span
              key={i}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs",
                e.tone === "primary" && "border-primary bg-primary text-primary-foreground",
                e.tone === "danger" && "border-red-200 text-red-700",
                e.tone === "ghost" && "border-border bg-background",
              )}
            >
              {e.label}
            </span>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button type="button" className={primaryButtonClass} disabled={busy || !dirty} onClick={save}>
          Guardar guía
        </button>
      </div>
    </div>
  );
}
