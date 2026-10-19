"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WEEKDAYS, MAX_RANGES_PER_DAY, type BusinessHours, type TimeRange, type Weekday } from "@/lib/business-hours";
import {
  addHoliday,
  loadPeruHolidays,
  removeHoliday,
  saveCompanyHours,
  saveTeamHours,
  type HoursActionResult,
} from "@/lib/actions/hours";
import { formatDate } from "@/lib/format";
import {
  addRange,
  copyDay,
  dayLabel,
  draftFromHours,
  draftHasRanges,
  draftToPayload,
  openWeekdaysIfEmpty,
  removeRange,
  sameDraft,
  setDayClosed,
  updateRange,
  type HoursDraft,
} from "./hours-rules";

export interface HoursViewData {
  workspaceId: string;
  companyHours: BusinessHours | null;
  teams: { id: string; name: string; hours: BusinessHours | null }[];
  holidays: { id: string; teamId: string | null; date: string; name: string }[];
}

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

function limaYear(): number {
  return new Date(Date.now() - 5 * 3_600_000).getUTCFullYear();
}

/** Opciones de hora cada 30 minutos; incluye el valor actual aunque no caiga en la grilla. */
function timeOptions(current: string, allowEnd: boolean): string[] {
  const list: string[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    list.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  if (allowEnd) list.push("24:00");
  if (!list.includes(current)) list.push(current);
  return list.sort();
}

function TimeSelect({
  value,
  onChange,
  allowEnd,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  allowEnd: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      disabled={disabled}
      className={`${inputClass} w-24 py-1.5`}
    >
      {timeOptions(value, allowEnd).map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function WeekEditor({
  draft,
  onChange,
  disabled,
}: {
  draft: HoursDraft;
  onChange: (d: HoursDraft) => void;
  disabled?: boolean;
}) {
  const [copyFrom, setCopyFrom] = useState<Weekday | null>(null);
  const [copyTo, setCopyTo] = useState<Weekday[]>([]);

  function applyCopy() {
    if (copyFrom && copyTo.length > 0) onChange(copyDay(draft, copyFrom, copyTo));
    setCopyFrom(null);
    setCopyTo([]);
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {WEEKDAYS.map((day) => {
        const ranges = draft[day];
        const closed = ranges.length === 0;
        return (
          <div key={day} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5">
            <div className="w-24 pt-1.5 text-sm font-medium">{dayLabel(day)}</div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {closed ? (
                <p className="pt-1.5 text-sm text-muted-foreground">Cerrado</p>
              ) : (
                ranges.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <TimeSelect
                      value={r[0]}
                      allowEnd={false}
                      label={`${dayLabel(day)}: inicio del tramo ${i + 1}`}
                      disabled={disabled}
                      onChange={(v) => onChange(updateRange(draft, day, i, [v, r[1]] as TimeRange))}
                    />
                    <span className="text-xs text-muted-foreground">a</span>
                    <TimeSelect
                      value={r[1]}
                      allowEnd
                      label={`${dayLabel(day)}: fin del tramo ${i + 1}`}
                      disabled={disabled}
                      onChange={(v) => onChange(updateRange(draft, day, i, [r[0], v] as TimeRange))}
                    />
                    {r[0] > r[1] && <span className="text-xs text-muted-foreground">termina al día siguiente</span>}
                    {r[0] === r[1] && (
                      <span className="text-xs text-destructive">Inicio y fin no pueden ser iguales</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(removeRange(draft, day, i))}
                      disabled={disabled}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Quitar el tramo ${i + 1} del ${dayLabel(day).toLowerCase()}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-1 pt-0.5">
              <button
                type="button"
                disabled={disabled || ranges.length >= MAX_RANGES_PER_DAY}
                onClick={() => onChange(addRange(draft, day))}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Tramo
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(setDayClosed(draft, day, !closed))}
                className="rounded-md px-2 py-1 text-xs hover:bg-muted"
              >
                {closed ? "Abrir" : "Cerrado"}
              </button>
              <button
                type="button"
                disabled={disabled || closed}
                onClick={() => {
                  setCopyFrom(copyFrom === day ? null : day);
                  setCopyTo([]);
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </button>
            </div>
            {copyFrom === day && (
              <div className="basis-full rounded-lg bg-muted/50 p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Copiar el horario del {dayLabel(day).toLowerCase()} a:
                </p>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.filter((d) => d !== day).map((d) => (
                    <label
                      key={d}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="checkbox"
                        checked={copyTo.includes(d)}
                        onChange={() => setCopyTo((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d]))}
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                      />
                      {dayLabel(d)}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={applyCopy} disabled={copyTo.length === 0} className={primaryButtonClass}>
                    Copiar
                  </button>
                  <button type="button" onClick={() => setCopyFrom(null)} className={secondaryButtonClass}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HolidaysEditor({ teamId, holidays }: { teamId: string | null; holidays: HoursViewData["holidays"] }) {
  const router = useRouter();
  const thisYear = limaYear();
  const [year, setYear] = useState(thisYear);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const mine = holidays.filter((h) => h.teamId === teamId && h.date.startsWith(`${year}-`));
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, year])].sort();

  async function act<T extends object>(
    fn: () => Promise<HoursActionResult<T>>,
    okText?: (r: T) => string,
  ): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if ("error" in r) {
        setMessage({ kind: "error", text: r.error });
        toast.error(r.error);
        return false;
      }
      if (okText) toast.success(okText(r));
      router.refresh();
      return true;
    } catch {
      setMessage({ kind: "error", text: "No se pudo completar la operación. Inténtalo de nuevo." });
      toast.error("No se pudo completar la operación. Inténtalo de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await act(() => addHoliday({ teamId, date, name }))) {
      setDate("");
      setName("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Feriados</h3>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Año de los feriados"
          className={`${inputClass} py-1`}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act(
              () => loadPeruHolidays({ teamId, year }),
              (r) =>
                r.added === 0
                  ? `Los feriados de Perú de ${year} ya estaban cargados.`
                  : `Se agregaron ${r.added} ${r.added === 1 ? "feriado" : "feriados"}${r.skipped > 0 ? ` (${r.skipped} ya existían)` : ""}.`,
            )
          }
          className={secondaryButtonClass}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Cargar feriados de Perú de {year}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {teamId === null
          ? "Los feriados de la empresa cierran a todos los equipos. Si no hay horario configurado, no tienen efecto."
          : "Además de los de la empresa, estos días el equipo no atiende. Revisa cada año: el gobierno puede agregar días no laborables, que se agregan a mano."}
      </p>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay feriados cargados para {year}.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {mine.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                {formatDate(`${h.date}T12:00:00-05:00`)}
              </span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => removeHoliday(h.id))}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label={`Quitar el feriado ${h.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
            disabled={busy}
            required
          />
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="Día no laborable"
            className={`${inputClass} w-full`}
            disabled={busy}
            required
          />
        </div>
        <button type="submit" disabled={busy || !date || !name.trim()} className={primaryButtonClass}>
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </form>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={cn("text-xs", message.kind === "error" ? "text-destructive" : "text-green-600")}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function ScopeCard({
  title,
  intro,
  initial,
  teamId,
  holidays,
  onSave,
  useCompanyOption,
}: {
  title: string;
  intro: string;
  initial: BusinessHours | null;
  teamId: string | null;
  holidays: HoursViewData["holidays"];
  onSave: (payload: BusinessHours | null) => Promise<HoursActionResult>;
  /** Equipos: casilla "usar el horario de la empresa". */
  useCompanyOption: boolean;
}) {
  const router = useRouter();
  const initialDraft = draftFromHours(initial);
  const [draft, setDraft] = useState<HoursDraft>(initialDraft);
  const [useCompany, setUseCompany] = useState(useCompanyOption && initial === null);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = !(useCompanyOption && useCompany);
  const dirty = useCompanyOption
    ? useCompany !== (initial === null) || (!useCompany && !sameDraft(draft, initialDraft))
    : !sameDraft(draft, initialDraft);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload = editing ? draftToPayload(draft) : null;
      const r = await onSave(payload);
      if ("error" in r) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success("Horario guardado");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch {
      setError("No se pudo guardar el horario. Inténtalo de nuevo.");
      toast.error("No se pudo guardar el horario. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{intro}</p>
      </div>

      {useCompanyOption && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useCompany}
            onChange={(e) => {
              setUseCompany(e.target.checked);
              if (!e.target.checked) setDraft((d) => openWeekdaysIfEmpty(d));
            }}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Usar el horario de la empresa
        </label>
      )}

      {editing && (
        <>
          <WeekEditor draft={draft} onChange={setDraft} disabled={saving} />
          {!useCompanyOption && !draftHasRanges(draft) && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Sin ningún tramo se atiende las 24 horas, todos los días, y los feriados no aplican.
            </p>
          )}
        </>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty} className={primaryButtonClass}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Guardando..." : "Guardar horario"}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" />
            Horario guardado
          </span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      <hr className="border-border" />
      <HolidaysEditor teamId={teamId} holidays={holidays} />
    </section>
  );
}

export function HoursView({ data }: { data: HoursViewData }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Volver a Configuración"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold">Horarios</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuándo atiende la empresa y cada equipo, en hora de Lima. Fuera de horario las gestiones nuevas esperan sin
          asignar hasta que abre, y puedes enviar una respuesta automática (en Atención).
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
          <ScopeCard
            title="Horario de la empresa"
            intro={
              data.teams.length > 0
                ? "Lo usan los equipos que no tienen un horario propio. Sin ningún tramo se atiende las 24 horas."
                : "Sin ningún tramo se atiende las 24 horas, todos los días."
            }
            initial={data.companyHours}
            teamId={null}
            holidays={data.holidays}
            useCompanyOption={false}
            onSave={(payload) => saveCompanyHours(data.workspaceId, payload)}
          />

          {data.teams.map((team) => (
            <ScopeCard
              key={team.id}
              title={`Equipo: ${team.name}`}
              intro="Con horario propio, solo cuenta el de este equipo. Los feriados de la empresa también aplican."
              initial={team.hours}
              teamId={team.id}
              holidays={data.holidays}
              useCompanyOption
              onSave={(payload) => saveTeamHours(team.id, payload)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
