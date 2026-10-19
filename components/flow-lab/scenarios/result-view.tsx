"use client";

// Detalle de una corrida: pasos, cada expectativa con lo esperado y lo obtenido,
// y (si se corrió en esta pantalla) la conversación que resultó.

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { describeStep, describeWhen } from "@/lib/flow-lab/scenarios/describe";
import type { ScenarioResult, ScenarioRun, ScenarioStep } from "@/lib/flow-lab/scenarios/types";
import { formatDateTime } from "@/lib/format";

const AUTHOR_LABEL = { client: "Cliente", bot: "Bot", agent: "Asesor" } as const;

export function ResultView({ result, steps, run }: { result: ScenarioResult; steps: readonly ScenarioStep[]; run?: ScenarioRun | null }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">Corrió el {formatDateTime(result.ranAt)}.</p>

      {result.stepError && (
        <div role="alert" className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">{result.stepError.step === 0 ? `No pudo arrancar: ${result.stepError.text}` : `Se detuvo en el paso ${result.stepError.step}: ${result.stepError.text}`}</p>
            <p>{result.stepError.message}</p>
          </div>
        </div>
      )}

      {result.expectations.length === 0 ? (
        <p className="text-xs text-muted-foreground">Este escenario no tiene expectativas.</p>
      ) : (
        <ul className="space-y-2">
          {result.expectations.map((e) => (
            <li key={e.id} className={`rounded-lg border px-3 py-2 ${e.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-start gap-2">
                {e.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.description}</p>
                  <p className="text-[11px] text-muted-foreground">{describeWhen({ after: e.after }, steps)}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground">Esperado</dt>
                    <dd>{e.expected || "—"}</dd>
                    <dt className="text-muted-foreground">Obtenido</dt>
                    <dd className={e.ok ? "" : "font-medium text-destructive"}>{e.actual || "—"}</dd>
                  </dl>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Pasos del escenario ({steps.length})</summary>
        <ol className="list-decimal space-y-1 px-8 pb-3 text-xs">
          {steps.map((s, i) => (
            <li key={i} className={result.stepError?.step === i + 1 ? "font-medium text-destructive" : ""}>
              {describeStep(s)}
            </li>
          ))}
        </ol>
      </details>

      {run?.finalState && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Conversación ({run.finalState.messages.length} mensajes)</summary>
          <ul className="space-y-1 px-3 pb-3 text-xs">
            {run.finalState.messages.map((m) => (
              <li key={m.id}>
                <span className="font-medium">{AUTHOR_LABEL[m.author]}:</span> {m.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
