"use client";

// Asistente de importación de contactos (docs/FASE-2-TECNICO.md 6): subir CSV,
// mapear columnas, vista previa validada y proceso por lotes en el servidor.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, pluralize } from "@/lib/format";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import {
  findExistingContacts,
  finishImport,
  processImportBatch,
  startImport,
  type ImportContext,
  type ImportFinalResult,
} from "@/lib/actions/import";
import { decodeCsvBytes, detectDelimiter, parseCsv, toCsv } from "@/lib/import/csv";
import {
  IMPORT_BATCH_SIZE,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  autoMapColumns,
  customKey,
  mapRows,
  type ColumnMapping,
  type ImportRowInput,
} from "@/lib/import/mapping";
import { normalizeImportPhone } from "@/lib/import/phone";
import { TEMPLATE_FILE_NAME, buildTemplateCsv } from "@/lib/import/template";
import {
  DEFAULT_IMPORT_OPTIONS,
  buildErrorsCsvRows,
  findFileDuplicates,
  summarizeRows,
  validateImportRow,
  type ImportErrorEntry,
  type ImportLookups,
  type ImportOptions,
  type RowStatus,
  type ValidatedRow,
} from "@/lib/import/validate";

type Step = "upload" | "map" | "preview" | "running" | "done";
type RunPhase = "starting" | "importing" | "finishing";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Archivo" },
  { key: "map", label: "Columnas" },
  { key: "preview", label: "Vista previa" },
  { key: "done", label: "Resultado" },
];

const SELECT_CLASS =
  "rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const BUTTON_PRIMARY =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
const BUTTON_SECONDARY =
  "inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50";
const PREVIEW_LIMIT = 200;

function downloadCsv(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_LABEL: Record<RowStatus, string> = {
  create: "Crear",
  update: "Actualizar",
  skip: "Saltar",
  error: "Error",
};
const STATUS_CLASS: Record<RowStatus, string> = {
  create: "bg-green-500/10 text-green-700 dark:text-green-400",
  update: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  skip: "bg-muted text-muted-foreground",
  error: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function ImportWizard({ context }: { context: ImportContext }) {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [phase, setPhase] = useState<RunPhase>("starting");
  const toast = useToast();

  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const [existing, setExisting] = useState<{ byPhone: Map<string, string>; byEmail: Map<string, string> }>({
    byPhone: new Map(),
    byEmail: new Map(),
  });
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [filter, setFilter] = useState<"all" | RowStatus | "warnings">("all");

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportFinalResult | null>(null);
  const [extra, setExtra] = useState({ scheduled: 0, linked: 0 });
  const fileInput = useRef<HTMLInputElement>(null);

  const lookups: ImportLookups = useMemo(
    () => ({
      types: context.types,
      teams: context.teams,
      members: context.members,
      tags: context.tags,
      customFields: context.customFields,
      existingByPhone: existing.byPhone,
      existingByEmail: existing.byEmail,
    }),
    [context, existing],
  );

  const inputRows: ImportRowInput[] = useMemo(() => {
    if (step === "upload" || step === "map") return [];
    const rows = mapRows(dataRows, mapping);
    const dups = findFileDuplicates(rows);
    return rows.map((r) => ({ ...r, fileDuplicateOf: dups.get(r.line) ?? null }));
  }, [step, dataRows, mapping]);

  const validated: ValidatedRow[] = useMemo(
    () => inputRows.map((r) => validateImportRow(r, lookups, options)),
    [inputRows, lookups, options],
  );
  const summary = useMemo(() => summarizeRows(validated), [validated]);

  // ── Paso 1: archivo ──────────────────────────────────────────────────────

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const decoded = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const rows = parseCsv(decoded.text, detectDelimiter(decoded.text));
      if (rows.length < 2) {
        setError("El archivo no tiene filas de datos. La primera fila debe ser el encabezado.");
        return;
      }
      if (rows.length - 1 > MAX_IMPORT_ROWS) {
        setError(
          `El archivo tiene ${formatNumber(rows.length - 1)} filas y el máximo es ${formatNumber(MAX_IMPORT_ROWS)}. Divídelo en varios archivos.`,
        );
        return;
      }
      const head = rows[0].map((h) => h.trim());
      setFileName(file.name);
      setEncoding(decoded.encoding === "utf-8" ? "UTF-8" : "Latin-1");
      setHeaders(head);
      setDataRows(rows.slice(1));
      setMapping(autoMapColumns(head, context.customFields));
      setStep("map");
    } catch {
      setError("No se pudo leer el archivo. Comprueba que sea un CSV.");
    } finally {
      setReading(false);
    }
  }

  // ── Paso 2 → 3: validar contra la base ───────────────────────────────────

  async function toPreview() {
    setError(null);
    setBusy(true);
    try {
      const rows = mapRows(dataRows, mapping);
      const phones: string[] = [];
      const emails: string[] = [];
      for (const r of rows) {
        const p = normalizeImportPhone(r.values.phone);
        if (p.ok && p.value) phones.push(p.value);
        if (r.values.email) emails.push(r.values.email.trim().toLowerCase());
      }
      const res = await findExistingContacts([...new Set(phones)], [...new Set(emails)]);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setExisting({ byPhone: new Map(Object.entries(res.byPhone)), byEmail: new Map(Object.entries(res.byEmail)) });
      setFilter("all");
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  // ── Paso 3 → 4: importar por lotes ───────────────────────────────────────

  async function runImport() {
    setError(null);
    setBusy(true);
    setStep("running");
    setPhase("starting");
    const rows = inputRows;
    setProgress({ done: 0, total: rows.length });
    try {
      const started = await startImport({ fileName, total: rows.length, options });
      if ("error" in started) {
        setError(started.error);
        toast.error(started.error);
        setStep("preview");
        return;
      }
      setPhase("importing");
      let scheduled = 0;
      let linked = 0;
      for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
        const part = rows.slice(i, i + IMPORT_BATCH_SIZE);
        const res = await processImportBatch({ batchId: started.batchId, rows: part, options });
        if ("error" in res) {
          setError(`${res.error} Las filas anteriores ya se importaron (ver el resultado).`);
          toast.error(res.error);
          break;
        }
        scheduled += res.result.scheduled;
        linked += res.result.linked;
        setProgress({ done: Math.min(i + part.length, rows.length), total: rows.length });
      }
      setPhase("finishing");
      const finished = await finishImport(started.batchId);
      if ("error" in finished) {
        setError(finished.error);
        toast.error(finished.error);
        setStep("preview");
        return;
      }
      setExtra({ scheduled, linked });
      setResult(finished.result);
      setStep("done");
      toast.success(
        `Importación terminada: ${formatNumber(finished.result.created)} creados, ${formatNumber(finished.result.updated)} actualizados.`,
      );
    } catch {
      setError("Se interrumpió la importación. Revisa tus contactos antes de volver a intentarlo.");
      toast.error("Se interrumpió la importación. Revisa tus contactos antes de volver a intentarlo.");
      setStep("preview");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep("upload");
    setError(null);
    setResult(null);
    setDataRows([]);
    setHeaders([]);
    setFileName("");
    setOptions(DEFAULT_IMPORT_OPTIONS);
    if (fileInput.current) fileInput.current.value = "";
  }

  const currentIndex = STEPS.findIndex((s) => s.key === (step === "running" ? "preview" : step));
  const canContinueMap = mapping.phone != null || mapping.email != null;
  const shown = validated.filter((r) => {
    if (filter === "all") return true;
    if (filter === "warnings") return r.warnings.length > 0;
    return r.status === filter;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/contacts"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Contactos"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Importar contactos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sube un archivo CSV con hasta {formatNumber(MAX_IMPORT_ROWS)} filas.
            </p>
          </div>
        </div>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                i === currentIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === "upload" && (
          <div className="max-w-2xl space-y-4">
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <FileUp className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Elige un archivo CSV</p>
              <p className="mt-1 text-xs text-muted-foreground">
                UTF-8 o Latin-1, separado por comas o punto y coma. La primera fila debe ser el encabezado.
              </p>
              {reading && (
                <p role="status" className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" />
                  Leyendo el archivo…
                </p>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0])}
                disabled={reading}
                className="mt-4 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsv(TEMPLATE_FILE_NAME, buildTemplateCsv(context.customFields.map((c) => c.slug)))
              }
              className={BUTTON_SECONDARY}
            >
              <Download className="h-4 w-4" />
              Descargar plantilla CSV
            </button>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Teléfono: 9 dígitos que empiezan en 9 se guardan como +51; con código de país se respeta.</li>
              <li>Fecha clave: dd/mm/aaaa o aaaa-mm-dd. Etiquetas: separadas por |.</li>
              <li>Tipo, sede y responsable (correo de un miembro) deben existir; si no, se avisa y se dejan en blanco.</li>
            </ul>
          </div>
        )}

        {step === "map" && (
          <div className="max-w-3xl space-y-4">
            <p className="text-sm text-muted-foreground">
              {fileName} · {formatNumber(dataRows.length)} filas · codificación {encoding}. Revisa a qué campo va cada
              columna; propusimos el mapeo según los encabezados.
            </p>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Campo del CRM</th>
                    <th className="px-4 py-2 font-medium">Columna del archivo</th>
                    <th className="px-4 py-2 font-medium">Ejemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...IMPORT_FIELDS.map((f) => ({ key: f.key as string, label: f.label })),
                    ...context.customFields.map((c) => ({ key: customKey(c.slug), label: `${c.name} (personalizado)` })),
                  ].map((f) => {
                    const idx = mapping[f.key] ?? null;
                    return (
                      <tr key={f.key} className="border-t border-border">
                        <td className="px-4 py-2 font-medium">{f.label}</td>
                        <td className="px-4 py-2">
                          <select
                            aria-label={f.label}
                            value={idx === null ? "" : String(idx)}
                            onChange={(e) =>
                              setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })
                            }
                            className={SELECT_CLASS}
                          >
                            <option value="">No importar</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h || `(columna ${i + 1})`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {idx === null ? "" : (dataRows[0]?.[idx] ?? "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!canContinueMap && (
              <p className="text-xs text-red-600">Asigna al menos la columna de teléfono o la de correo.</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={restart} className={BUTTON_SECONDARY}>
                Cambiar archivo
              </button>
              <button type="button" disabled={!canContinueMap || busy} onClick={toPreview} className={BUTTON_PRIMARY}>
                {busy && <Spinner />}
                {busy ? "Validando contactos…" : "Ver vista previa"}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-6">
            <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ["Filas", summary.total, "all"],
                  ["Se crean", summary.create, "create"],
                  ["Se actualizan", summary.update, "update"],
                  ["Se saltan", summary.skip, "skip"],
                  ["Con error", summary.error, "error"],
                ] as const
              ).map(([label, value, key]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left",
                    filter === key ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
                  )}
                >
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-xl font-semibold">{formatNumber(value)}</div>
                </button>
              ))}
            </div>
            {summary.withWarnings > 0 && (
              <button
                type="button"
                onClick={() => setFilter("warnings")}
                className="text-xs text-amber-700 underline dark:text-amber-400"
              >
                {formatNumber(summary.withWarnings)} filas con avisos (un valor desconocido se dejará en blanco)
              </button>
            )}

            <div className="max-w-3xl space-y-3 rounded-lg border border-border p-4">
              <h2 className="text-sm font-semibold">Opciones</h2>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="existing"
                    checked={options.existing === "skip"}
                    onChange={() => setOptions({ ...options, existing: "skip" })}
                  />
                  Saltar los que ya existen
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="existing"
                    checked={options.existing === "update"}
                    onChange={() => setOptions({ ...options, existing: "update" })}
                  />
                  Actualizar los que ya existen
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.createTags}
                  onChange={(e) => setOptions({ ...options, createTags: e.target.checked })}
                />
                Crear las etiquetas que no existan
              </label>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                Vincular el teléfono al canal de WhatsApp:
                <select
                  value={options.channelId ?? ""}
                  onChange={(e) => setOptions({ ...options, channelId: e.target.value || null })}
                  className={SELECT_CLASS}
                >
                  <option value="">No vincular</option>
                  {context.whatsappChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.scheduleCases}
                  onChange={(e) => setOptions({ ...options, scheduleCases: e.target.checked })}
                />
                Programar gestiones según la fecha clave
              </label>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Fila</th>
                    <th className="px-4 py-2 font-medium">Nombre</th>
                    <th className="px-4 py-2 font-medium">Teléfono</th>
                    <th className="px-4 py-2 font-medium">Correo</th>
                    <th className="px-4 py-2 font-medium">Fecha clave</th>
                    <th className="px-4 py-2 font-medium">Acción</th>
                    <th className="px-4 py-2 font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, PREVIEW_LIMIT).map((r) => (
                    <tr key={r.line} className="border-t border-border align-top">
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.line}</td>
                      <td className="px-4 py-2">{r.contact.displayName ?? "—"}</td>
                      <td className="px-4 py-2">{r.contact.phone ?? "—"}</td>
                      <td className="px-4 py-2">{r.contact.email ?? "—"}</td>
                      <td className="px-4 py-2">{r.contact.keyDate ?? "—"}</td>
                      <td className="px-4 py-2">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[r.status])}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.errors.map((m) => (
                          <div key={m} className="text-red-600">
                            {m}
                          </div>
                        ))}
                        {r.skipReason && <div className="text-muted-foreground">{r.skipReason}</div>}
                        {r.warnings.map((m) => (
                          <div key={m} className="text-amber-700 dark:text-amber-400">
                            {m}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No hay filas con este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {shown.length > PREVIEW_LIMIT && (
                <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  Se muestran las primeras {PREVIEW_LIMIT} de {formatNumber(shown.length)} filas; la importación
                  procesa todas.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setStep("map")} className={BUTTON_SECONDARY}>
                Volver a las columnas
              </button>
              <button
                type="button"
                disabled={busy || summary.create + summary.update === 0}
                onClick={runImport}
                className={BUTTON_PRIMARY}
              >
                {busy && <Spinner />}
                Importar {pluralize(summary.create + summary.update, "contacto", "contactos")}
              </button>
            </div>
          </div>
        )}

        {step === "running" && (
          <div role="status" className="max-w-md space-y-4 animate-fade-in">
            <p className="text-sm font-medium">Importando contactos… no cierres esta página.</p>
            <ol className="space-y-2 text-sm">
              {(
                [
                  ["starting", "Preparando la importación"],
                  ["importing", "Importando filas"],
                  ["finishing", "Cerrando y armando el resumen"],
                ] as [RunPhase, string][]
              ).map(([key, label], i) => {
                const order = ["starting", "importing", "finishing"];
                const state = order.indexOf(phase) > i ? "done" : order.indexOf(phase) === i ? "active" : "todo";
                return (
                  <li
                    key={key}
                    className={cn(
                      "flex items-center gap-2",
                      state === "todo" && "text-muted-foreground/60",
                      state === "active" && "font-medium",
                    )}
                  >
                    {state === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : state === "active" ? (
                      <Spinner />
                    ) : (
                      <span className="h-4 w-4 rounded-full border border-border" />
                    )}
                    {label}
                  </li>
                );
              })}
            </ol>
            <div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatNumber(progress.done)} de {formatNumber(progress.total)} {progress.total === 1 ? "fila" : "filas"}
              </p>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <DoneStep
            result={result}
            extra={extra}
            options={options}
            onErrorsCsv={() =>
              downloadCsv("errores-importacion.csv", toCsv(buildErrorsCsvRows(headers, dataRows, result.errors)))
            }
            onRestart={restart}
          />
        )}
      </div>
    </div>
  );
}

function DoneStep({
  result,
  extra,
  options,
  onErrorsCsv,
  onRestart,
}: {
  result: ImportFinalResult;
  extra: { scheduled: number; linked: number };
  options: ImportOptions;
  onErrorsCsv: () => void;
  onRestart: () => void;
}) {
  const errors: ImportErrorEntry[] = result.errors;
  return (
    <div className="max-w-3xl space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        Importación terminada: {result.fileName || "archivo"}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Creados", result.created],
          ["Actualizados", result.updated],
          ["Saltados", result.skipped],
          ["Con error", errors.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold">{formatNumber(value as number)}</div>
          </div>
        ))}
      </div>
      {(options.scheduleCases || options.channelId) && (
        <p className="text-sm text-muted-foreground">
          {options.scheduleCases && <>Gestiones programadas: {formatNumber(extra.scheduled)}. </>}
          {options.channelId && <>Teléfonos vinculados al canal: {formatNumber(extra.linked)}.</>}
        </p>
      )}
      {errors.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={onErrorsCsv} className={BUTTON_SECONDARY}>
            <Download className="h-4 w-4" />
            Descargar CSV de errores
          </button>
          <ul className="max-h-48 overflow-auto rounded-lg border border-border p-3 text-xs">
            {errors.slice(0, 50).map((e) => (
              <li key={`${e.line}-${e.message}`}>
                Fila {e.line}: {e.message}
              </li>
            ))}
            {errors.length > 50 && <li className="text-muted-foreground">... y {errors.length - 50} más en el CSV.</li>}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Link href="/dashboard/contacts" className={BUTTON_PRIMARY}>
          Ver contactos
        </Link>
        <button type="button" onClick={onRestart} className={BUTTON_SECONDARY}>
          Importar otro archivo
        </button>
      </div>
    </div>
  );
}
