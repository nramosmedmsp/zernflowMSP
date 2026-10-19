"use client";

// Escenarios guardados del laboratorio: lista con el último resultado, correr
// uno o todos (en el navegador, con el catálogo actual), ver el detalle de cada
// expectativa, abrir en el laboratorio, editar, duplicar y borrar.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, FlaskConical, ListChecks, Pencil, Play, PlayCircle, Plus, Trash2 } from "lucide-react";
import {
  addExampleLabScenarios,
  createLabScenario,
  deleteLabScenario,
  saveLabScenarioResults,
  updateLabScenario,
  type LabScenarioRow,
} from "@/lib/actions/lab-scenarios";
import { runScenario } from "@/lib/flow-lab/scenarios/run";
import type { ScenarioRun } from "@/lib/flow-lab/scenarios/types";
import type { LabCatalog } from "@/lib/flow-lab/types";
import { formatDateTime } from "@/lib/format";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
import { ResultView } from "./result-view";
import { ScenarioFormDialog, type ScenarioDraft } from "./scenario-form-dialog";
import { STATUS_TEXT, copyName, resultSummary, statusOf, totalsText, type ScenarioStatus } from "./scenarios-model";

const BADGE: Record<ScenarioStatus, string> = {
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  never: "bg-muted text-muted-foreground",
};
const DOT: Record<ScenarioStatus, string> = { passed: "bg-emerald-500", failed: "bg-red-500", never: "bg-muted-foreground/40" };

const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50";

export function ScenariosScreen({ catalog, initialScenarios, hasExamples }: { catalog: LabCatalog; initialScenarios: LabScenarioRow[]; hasExamples: boolean }) {
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [runs, setRuns] = useState<Record<string, ScenarioRun>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<LabScenarioRow | null>(null);
  const [deleting, setDeleting] = useState<LabScenarioRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "all", "examples", o el id
  const toast = useToast();

  const statuses = scenarios.map((s) => statusOf(s.lastResult));

  function patchRow(id: string, patch: Partial<LabScenarioRow>) {
    setScenarios((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  /** Corre uno con el catálogo actual; null si su definición está dañada. */
  function runRow(row: LabScenarioRow): ScenarioRun | null {
    if (!row.definition) return null;
    try {
      return runScenario(catalog, row.definition);
    } catch (e) {
      const message = e instanceof Error ? e.message : "error desconocido";
      return {
        result: { ok: false, ranAt: new Date().toISOString(), total: 0, passed: 0, failed: 0, stepError: { step: 0, text: "Escenario", message: `La simulación falló: ${message}` }, expectations: [] },
        traces: [],
        initialState: null,
        states: [],
        finalState: null,
      };
    }
  }

  async function saveResults(items: { id: string; run: ScenarioRun }[]) {
    try {
      const saved = await saveLabScenarioResults(items.map((i) => ({ id: i.id, result: i.run.result })));
      return "error" in saved ? saved.error : null;
    } catch {
      return "revisa tu conexión e inténtalo de nuevo";
    }
  }

  async function testOne(row: LabScenarioRow) {
    setBusy(row.id);
    const run = runRow(row);
    if (!run) {
      setBusy(null);
      toast.error(`El escenario «${row.name}» está dañado: ${row.definitionError ?? "no se entiende su definición"}.`);
      return;
    }
    setRuns((r) => ({ ...r, [row.id]: run }));
    patchRow(row.id, { lastResult: run.result, lastRunAt: run.result.ranAt });
    setOpen(row.id);
    const failure = await saveResults([{ id: row.id, run }]);
    setBusy(null);
    if (failure) toast.error(`Se corrió, pero no se pudo guardar el resultado: ${failure}`);
    else if (run.result.ok) toast.success("El escenario pasó");
    else toast.error("El escenario falló. Mira el detalle de cada expectativa.");
  }

  async function testAll() {
    setBusy("all");
    const done: { id: string; run: ScenarioRun }[] = [];
    let damaged = 0;
    for (const row of scenarios) {
      // Deja respirar al navegador entre escenarios.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const run = runRow(row);
      if (!run) {
        damaged++;
        continue;
      }
      done.push({ id: row.id, run });
      setRuns((r) => ({ ...r, [row.id]: run }));
      patchRow(row.id, { lastResult: run.result, lastRunAt: run.result.ranAt });
    }
    const failure = done.length > 0 ? await saveResults(done) : null;
    setBusy(null);
    const totals = totalsText(done.map((d) => (d.run.result.ok ? "passed" : "failed")));
    const extra = damaged > 0 ? ` ${damaged} no se pudo${damaged === 1 ? "" : "ieron"} correr por estar dañado${damaged === 1 ? "" : "s"}.` : "";
    if (failure) toast.error(`Se corrieron (${totals}), pero no se pudieron guardar los resultados: ${failure}`);
    else if (done.some((d) => !d.run.result.ok)) toast.error(`Listo: ${totals}.${extra}`);
    else toast.success(`Listo: ${totals}.${extra}`);
  }

  async function addExamples() {
    setBusy("examples");
    try {
      const res = await addExampleLabScenarios();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setScenarios((list) => [...list, ...res.scenarios]);
      toast.success(
        res.added === 0 ? "Ya tienes todos los escenarios de ejemplo." : `Se agregaron ${res.added} escenarios de ejemplo${res.skipped ? ` (${res.skipped} ya existían con ese nombre)` : ""}. Pulsa «Probar todos» para correrlos.`,
      );
    } catch {
      toast.error("No se pudieron agregar los escenarios de ejemplo. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(row: LabScenarioRow) {
    if (!row.definition) return;
    setBusy(row.id);
    try {
      const res = await createLabScenario({ name: copyName(row.name, scenarios.map((s) => s.name)), description: row.description, definition: row.definition });
      if ("error" in res) toast.error(res.error);
      else {
        setScenarios((list) => [...list, res.scenario]);
        toast.success("Escenario duplicado");
      }
    } catch {
      toast.error("No se pudo duplicar el escenario. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: LabScenarioRow) {
    setDeleting(null);
    setBusy(row.id);
    try {
      const res = await deleteLabScenario(row.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setScenarios((list) => list.filter((s) => s.id !== row.id));
      setRuns(({ [row.id]: _gone, ...rest }) => rest);
      toast.success(`Se borró «${row.name}».`);
    } catch {
      toast.error("No se pudo borrar el escenario. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(row: LabScenarioRow, draft: ScenarioDraft): Promise<string | null> {
    let res: Awaited<ReturnType<typeof updateLabScenario>>;
    try {
      res = await updateLabScenario(row.id, { name: draft.name, description: draft.description, definition: draft.definition });
    } catch {
      return "No se pudo guardar. Inténtalo de nuevo.";
    }
    if ("error" in res) return res.error;
    setScenarios((list) => list.map((s) => (s.id === row.id ? res.scenario : s)));
    setRuns(({ [row.id]: _stale, ...rest }) => rest);
    setEditing(null);
    toast.success("Se guardaron los cambios. El resultado anterior se borró: vuelve a probar el escenario.");
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/flows" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Flujos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <ListChecks className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Escenarios</h1>
              <p className="mt-1 text-sm text-muted-foreground">Conversaciones de prueba guardadas: córrelas todas después de editar tus flujos para ver si algo dejó de funcionar.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/flows/lab" className={secondaryButtonClass}>
              <FlaskConical className="h-4 w-4" />
              Laboratorio
            </Link>
            {hasExamples && (
              <button type="button" onClick={addExamples} disabled={busy !== null} className={secondaryButtonClass}>
                <Plus className="h-4 w-4" />
                {busy === "examples" ? "Agregando…" : "Agregar escenarios de ejemplo"}
              </button>
            )}
            <button type="button" onClick={testAll} disabled={busy !== null || scenarios.length === 0} className={primaryButtonClass}>
              <PlayCircle className="h-4 w-4" />
              {busy === "all" ? "Probando…" : "Probar todos"}
            </button>
          </div>
        </div>
        {scenarios.length > 0 && <p className="mt-3 text-sm text-muted-foreground">{totalsText(statuses)}.</p>}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-8">
        {scenarios.length === 0 && (
          <div className="mx-auto mt-10 max-w-md space-y-2 text-center">
            <p className="text-sm font-medium">Todavía no tienes escenarios</p>
            <p className="text-sm text-muted-foreground">
              Haz una prueba en el <Link href="/dashboard/flows/lab" className="underline">laboratorio</Link> y guárdala con «Guardar como escenario»
              {hasExamples ? ", o instala los escenarios de ejemplo de tu plantilla de negocio." : "."}
            </p>
          </div>
        )}

        {scenarios.map((row) => {
          const status = statusOf(row.lastResult);
          const expanded = open === row.id;
          const working = busy === row.id || busy === "all";
          return (
            <section key={row.id} className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
                <button type="button" onClick={() => setOpen(expanded ? null : row.id)} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
                  <p className="truncate text-sm font-semibold">{row.name}</p>
                  {row.description && <p className="line-clamp-2 text-xs text-muted-foreground">{row.description}</p>}
                  {row.definitionError && <p className="text-xs text-destructive">Escenario dañado: {row.definitionError}</p>}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[status]}`}>{STATUS_TEXT[status]}</span>
                  <span className="text-[11px] text-muted-foreground">{status === "never" ? "—" : `${resultSummary(row.lastResult)} · ${row.lastRunAt ? formatDateTime(row.lastRunAt) : ""}`}</span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => testOne(row)} disabled={busy !== null || !row.definition} className={iconButton} title="Probar" aria-label={`Probar ${row.name}`}>
                    <Play className="h-4 w-4" />
                  </button>
                  {row.definition && (
                    <Link href={`/dashboard/flows/lab?scenario=${row.id}`} className={iconButton} title="Abrir en el laboratorio (reproduce los pasos)" aria-label={`Abrir ${row.name} en el laboratorio`}>
                      <FlaskConical className="h-4 w-4" />
                    </Link>
                  )}
                  <button type="button" onClick={() => setEditing(row)} disabled={busy !== null || !row.definition} className={iconButton} title="Editar nombre, descripción y expectativas" aria-label={`Editar ${row.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => duplicate(row)} disabled={busy !== null || !row.definition} className={iconButton} title="Duplicar" aria-label={`Duplicar ${row.name}`}>
                    <Copy className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setDeleting(row)} disabled={busy !== null} className={`${iconButton} hover:text-destructive`} title="Borrar" aria-label={`Borrar ${row.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {busy === row.id && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Probando…</p>}
              {expanded && !working && (
                <div className="border-t border-border px-4 py-3">
                  {row.lastResult && row.definition ? (
                    <ResultView result={row.lastResult} steps={row.definition.steps} run={runs[row.id]} />
                  ) : row.definition ? (
                    <p className="text-xs text-muted-foreground">Todavía no se ha corrido. Pulsa «Probar» para ver el resultado de cada expectativa.</p>
                  ) : (
                    <p className="text-xs text-destructive">La definición de este escenario no se entiende. Bórralo y vuelve a crearlo desde el laboratorio.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {editing?.definition && (
        <ScenarioFormDialog
          title="Editar escenario"
          confirmLabel="Guardar cambios"
          catalog={catalog}
          initial={{ name: editing.name, description: editing.description, definition: editing.definition }}
          onClose={() => setEditing(null)}
          onSave={(draft) => saveEdit(editing, draft)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Borrar escenario"
        message={deleting ? `Se borrará «${deleting.name}» y su último resultado. No se puede deshacer.` : ""}
        confirmLabel="Borrar"
        destructive
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
