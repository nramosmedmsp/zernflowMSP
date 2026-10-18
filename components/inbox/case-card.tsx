"use client";

// Tarjeta de gestión en la cabecera del chat (docs/FASE-1-TECNICO.md 4.1):
// tipo, etapa, categoría, responsable, próximo contacto, Cerrar y Nueva
// gestión. Todas las escrituras pasan por las acciones de lib/actions/cases.ts.

import { useCallback, useState } from "react";
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Hand,
  Loader2,
  Plus,
  Undo2,
  UserRound,
} from "lucide-react";
import {
  assignCase,
  changeCaseStage,
  classifyCase,
  setCaseCategory,
  setNextAction,
  takeCase,
  transferCase,
  type CaseActionResult,
  type CaseView,
  type ContactCasesView,
} from "@/lib/actions/cases";
import { limaDateOf } from "@/lib/cases/dates";
import { OUTCOME_LABELS } from "@/lib/cases/rules";
import { formatDate, formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CloseCaseDialog } from "./close-case-dialog";
import { NewCaseDialog } from "./new-case-dialog";
import { memberName, type InboxMember } from "./inbox-model";
import { ErrorText, Popover, inputClass, primaryButtonClass, secondaryButtonClass, selectClass } from "./ui";

const chipButton =
  "inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

const menuItem =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50";

export function CaseCard({
  data,
  activeCaseId,
  members,
  onSelectCase,
  onChanged,
}: {
  data: ContactCasesView;
  activeCaseId: string | null;
  members: InboxMember[];
  onSelectCase: (caseId: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);

  const active =
    data.cases.find((c) => c.id === activeCaseId) ??
    data.recentClosed.find((c) => c.id === activeCaseId) ??
    null;
  const caseType = active?.caseTypeId ? data.caseTypes.find((t) => t.id === active.caseTypeId) ?? null : null;

  const run = useCallback(
    async (key: string, action: () => Promise<CaseActionResult<object>>, success?: string) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const result = await action();
        if ("error" in result) {
          setError(result.error);
          return false;
        }
        if (success) setNotice(success);
        await onChanged();
        return true;
      } catch {
        setError("No se pudo guardar el cambio. Inténtalo de nuevo.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const closeAssign = useCallback(() => setAssignOpen(false), []);
  const closeNext = useCallback(() => setNextOpen(false), []);

  const newCaseButton = data.canOpenCase && (
    <button onClick={() => setCreating(true)} className={chipButton}>
      <Plus className="h-3.5 w-3.5" />
      Nueva gestión
    </button>
  );

  const dialogs = (
    <>
      {creating && (
        <NewCaseDialog
          data={data}
          members={members}
          onCancel={() => setCreating(false)}
          onCreated={async (caseId, message) => {
            setCreating(false);
            setNotice(message);
            await onChanged();
            onSelectCase(caseId);
          }}
        />
      )}
      {closing && active && (
        <CloseCaseDialog
          caseView={active}
          caseType={caseType}
          onCancel={() => setClosing(false)}
          onClosed={async (message) => {
            setClosing(false);
            setNotice(message);
            await onChanged();
          }}
        />
      )}
    </>
  );

  if (!active) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
        <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Sin gestión abierta</span>
        {newCaseButton}
        {notice && <span className="text-green-700">{notice}</span>}
        <ErrorText>{error}</ErrorText>
        {dialogs}
      </div>
    );
  }

  const perms = active.permissions;
  const isClosed = active.status !== "open" && active.status !== "scheduled";
  const types = data.caseTypes.filter((t) => !t.archived || t.id === active.caseTypeId);
  const openStages = (caseType?.stages ?? []).filter(
    (s) => (s.kind === "open" && !s.archived) || s.id === active.stageId,
  );
  const categories = (caseType?.categories ?? []).filter((c) => !c.archived || c.id === active.categoryId);

  // Personas a las que puedo asignar: administrador a cualquiera; supervisor
  // a las del equipo de la gestión (o del contacto).
  const scopeTeam = active.teamId ?? data.contact.teamId;
  const assignable = perms.canAssign
    ? members.filter(
        (m) =>
          m.userId !== active.assigneeId &&
          (data.me.isAdmin || (!!scopeTeam && m.teams.some((t) => t.teamId === scopeTeam))),
      )
    : [];
  const hasAssignMenu = perms.canAssign || perms.canTake || perms.canReturnToQueue || perms.canTransfer;
  const teamName = data.teams.find((t) => t.id === active.teamId)?.name ?? null;

  function caseLabel(c: CaseView): string {
    const type = c.caseTypeId ? data.caseTypes.find((t) => t.id === c.caseTypeId) : null;
    const stage = type?.stages.find((s) => s.id === c.stageId);
    const parts = [type?.name ?? "Sin clasificar"];
    if (c.status === "scheduled") parts.push(`programada ${formatDate(c.scheduledFor)}`);
    else if (stage) parts.push(stage.name);
    if (c.status === "open") parts.push(memberName(members, c.assigneeId));
    return parts.join(" · ");
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border bg-muted/30 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />

        {data.cases.length > 1 || isClosed ? (
          <select
            value={active.id}
            onChange={(e) => onSelectCase(e.target.value)}
            className={cn(selectClass, "max-w-56 font-medium")}
            aria-label="Gestión"
          >
            {data.cases.map((c, i) => (
              <option key={c.id} value={c.id}>
                {i + 1}. {caseLabel(c)}
              </option>
            ))}
            {isClosed && (
              <option value={active.id}>
                Cerrada: {caseLabel(active)}
              </option>
            )}
          </select>
        ) : null}

        {isClosed ? (
          <span className="text-xs text-muted-foreground">
            {active.status === "cancelled"
              ? "Cancelada"
              : `Cerrada como ${OUTCOME_LABELS[active.status as keyof typeof OUTCOME_LABELS]?.toLowerCase() ?? active.status}`}
            {active.closedAt ? ` el ${formatDate(active.closedAt)}` : ""}
          </span>
        ) : (
          <>
            {active.status === "scheduled" && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                Programada para {formatDate(active.scheduledFor)}
              </span>
            )}

            {/* Tipo */}
            <select
              value={active.caseTypeId ?? ""}
              disabled={!perms.canEdit || busy !== null}
              onChange={(e) => {
                if (e.target.value) {
                  void run("type", async () => {
                    const r = await classifyCase(active.id, e.target.value);
                    if ("ok" in r && r.rerouted) setNotice("La gestión se envió a otro equipo según su tipo.");
                    return r;
                  });
                }
              }}
              className={selectClass}
              aria-label="Tipo de gestión"
            >
              {!active.caseTypeId && <option value="">Sin clasificar</option>}
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.archived ? " (archivado)" : ""}
                </option>
              ))}
            </select>

            {/* Etapa */}
            {caseType && openStages.length > 0 && (
              <select
                value={active.stageId ?? ""}
                disabled={!perms.canEdit || busy !== null}
                onChange={(e) => {
                  if (e.target.value) void run("stage", () => changeCaseStage(active.id, e.target.value));
                }}
                className={selectClass}
                aria-label="Etapa"
              >
                {!active.stageId && <option value="">Sin etapa</option>}
                {openStages.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.kind !== "open"}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            {/* Categoría */}
            {caseType && categories.length > 0 && (
              <select
                value={active.categoryId ?? ""}
                disabled={!perms.canEdit || busy !== null}
                onChange={(e) => void run("category", () => setCaseCategory(active.id, e.target.value || null))}
                className={selectClass}
                aria-label="Categoría"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isHighPriority ? " (prioridad)" : ""}
                  </option>
                ))}
              </select>
            )}

            {/* Responsable */}
            <Popover
              open={assignOpen}
              onClose={closeAssign}
              trigger={
                <button
                  onClick={() => setAssignOpen((v) => !v)}
                  disabled={!hasAssignMenu || busy !== null}
                  className={chipButton}
                  title={teamName ? `Equipo: ${teamName}` : undefined}
                >
                  <UserRound className="h-3.5 w-3.5" />
                  {memberName(members, active.assigneeId)}
                </button>
              }
            >
              <div className="space-y-1">
                {perms.canTake && (
                  <button
                    className={menuItem}
                    onClick={() => {
                      setAssignOpen(false);
                      void run("assign", () => takeCase(active.id), "Tomaste la gestión.");
                    }}
                  >
                    <Hand className="h-3.5 w-3.5" />
                    Tomar
                  </button>
                )}
                {perms.canReturnToQueue && (
                  <button
                    className={menuItem}
                    onClick={() => {
                      setAssignOpen(false);
                      void run("assign", () => assignCase(active.id, null), "La gestión volvió a la cola.");
                    }}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Devolver a la cola
                  </button>
                )}
                {assignable.length > 0 && (
                  <div className="border-t border-border pt-1">
                    <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">Asignar a</p>
                    <div className="max-h-48 overflow-y-auto">
                      {assignable.map((m) => (
                        <button
                          key={m.userId}
                          className={menuItem}
                          onClick={() => {
                            setAssignOpen(false);
                            void run("assign", () => assignCase(active.id, m.userId), `Asignada a ${m.name}.`);
                          }}
                        >
                          <span className="truncate">{m.name}</span>
                          {m.availability === "away" && (
                            <span className="ml-auto text-[10px] text-muted-foreground">Ausente</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {perms.canTransfer && data.teams.length > 0 && (
                  <div className="border-t border-border pt-1">
                    <p className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                      <ArrowRightLeft className="h-3 w-3" />
                      Transferir a equipo
                    </p>
                    <select
                      value={active.teamId ?? ""}
                      onChange={(e) => {
                        setAssignOpen(false);
                        const teamId = e.target.value || null;
                        const name = data.teams.find((t) => t.id === teamId)?.name;
                        void run(
                          "assign",
                          () => transferCase(active.id, teamId),
                          name ? `Transferida al equipo ${name}.` : "La gestión quedó sin equipo.",
                        );
                      }}
                      className={cn(selectClass, "w-full")}
                      aria-label="Equipo"
                    >
                      <option value="">Sin equipo</option>
                      {data.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </Popover>

            {/* Próximo contacto */}
            <Popover
              open={nextOpen}
              onClose={closeNext}
              trigger={
                <button
                  onClick={() => setNextOpen((v) => !v)}
                  disabled={!perms.canEdit || busy !== null}
                  className={chipButton}
                  title={active.nextActionNote ?? undefined}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {active.nextActionAt ? `Próximo contacto ${formatRelative(active.nextActionAt)}` : "Próximo contacto"}
                </button>
              }
              className="w-72"
            >
              <NextActionForm
                caseView={active}
                saving={busy === "next"}
                onSave={async (at, note) => {
                  const ok = await run("next", () => setNextAction(active.id, at, note), at ? "Próximo contacto guardado." : "Próximo contacto quitado.");
                  if (ok) setNextOpen(false);
                }}
              />
            </Popover>

            {perms.canClose && (
              <button onClick={() => setClosing(true)} disabled={busy !== null} className={chipButton}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cerrar
              </button>
            )}
          </>
        )}

        {newCaseButton}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {active.nextActionNote && active.nextActionAt && !isClosed && (
        <p className="truncate text-[11px] text-muted-foreground">Nota: {active.nextActionNote}</p>
      )}
      {notice && <p className="text-xs text-green-700">{notice}</p>}
      <ErrorText>{error}</ErrorText>
      {dialogs}
    </div>
  );
}

function NextActionForm({
  caseView,
  saving,
  onSave,
}: {
  caseView: CaseView;
  saving: boolean;
  onSave: (at: string | null, note: string | null) => void;
}) {
  const current = caseView.nextActionAt;
  const [date, setDate] = useState(current ? limaDateOf(new Date(current)) : "");
  const [time, setTime] = useState(current ? formatTime(current) : "");
  const [note, setNote] = useState(caseView.nextActionNote ?? "");

  function submit() {
    if (!date) return;
    // Hora de Lima (UTC-5, sin horario de verano); sin hora, el servidor usa las 09:00.
    const at = time ? `${date}T${time}:00-05:00` : date;
    onSave(at, note.trim() || null);
  }

  return (
    <div className="space-y-2 p-1">
      <p className="text-xs font-medium">Próximo contacto</p>
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(inputClass, "py-1 text-xs")}
          aria-label="Fecha"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={cn(inputClass, "w-28 py-1 text-xs")}
          aria-label="Hora"
        />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Nota (opcional)"
        className={cn(inputClass, "resize-none py-1 text-xs")}
      />
      <div className="flex justify-end gap-2">
        {current && (
          <button onClick={() => onSave(null, null)} disabled={saving} className={cn(secondaryButtonClass, "py-1 text-xs")}>
            Quitar
          </button>
        )}
        <button onClick={submit} disabled={saving || !date} className={cn(primaryButtonClass, "py-1 text-xs")}>
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  );
}
