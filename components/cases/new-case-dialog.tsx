"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, limaDateOf } from "@/lib/cases/dates";
import { listContactActiveCases, openManualCase } from "@/lib/actions/cases";
import { ParallelCaseWarning, hasSameTypeOpen, type ParallelCase } from "./parallel-case-warning";
import { searchContacts, type ContactSearchResult } from "@/lib/actions/contacts";

type AssignMode = "me" | "auto" | "person";

interface Props {
  open: boolean;
  onClose: () => void;
  caseTypes: { id: string; name: string }[];
  /** A quién puede asignar quien la crea (administrador o supervisor). */
  members: { userId: string; name: string }[];
  canAssignOthers: boolean;
  onCreated: (result: { contactId: string; caseId: string; status: "open" | "scheduled"; scheduledFor: string | null }) => void;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Se monta solo mientras está abierto: así cada apertura parte de cero. */
export function NewCaseDialog(props: Props) {
  return props.open ? <NewCaseForm {...props} /> : null;
}

function NewCaseForm({ onClose, caseTypes, members, canAssignOthers, onCreated }: Props) {
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; list: ContactSearchResult[] } | null>(null);
  const [contact, setContact] = useState<ContactSearchResult | null>(null);
  const [caseTypeId, setCaseTypeId] = useState("");
  const [mode, setMode] = useState<AssignMode>("me");
  const [personId, setPersonId] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Gestiones abiertas del contacto elegido (M-32): se avisa antes de duplicar.
  const [active, setActive] = useState<{ contactId: string; cases: ParallelCase[] } | null>(null);
  // Confirmación ligada al contacto: al cambiar de contacto deja de valer.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Búsqueda de contactos con espera, descartando respuestas viejas.
  useEffect(() => {
    if (contact) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const res = await searchContacts(query);
      if (seq !== searchSeq.current) return;
      setLoaded({ query, list: "error" in res ? [] : res.contacts });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, contact]);

  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    void listContactActiveCases(contact.id).then((res) => {
      if (!cancelled) setActive({ contactId: contact.id, cases: "error" in res ? [] : res.cases });
    });
    return () => {
      cancelled = true;
    };
  }, [contact]);

  const confirmParallel = !!contact && confirmedFor === contact.id;
  const existing = contact && active?.contactId === contact.id ? active.cases : [];
  const loadingExisting = !!contact && active?.contactId !== contact.id;

  const results = loaded?.list ?? [];
  const searching = loaded?.query !== query;

  const scheduling = date !== "";
  const tomorrow = addDays(limaDateOf(new Date()), 1);

  async function submit() {
    setError(null);
    if (!contact) return setError("Elige un contacto.");
    if (scheduling && !caseTypeId) return setError("Elige el tipo de la gestión que vas a programar.");
    if (scheduling && date < tomorrow) return setError("La fecha programada debe ser a partir de mañana.");
    if (!scheduling && mode === "person" && !personId) return setError("Elige a quién asignarla.");
    if (hasSameTypeOpen(existing, caseTypeId || null)) return setError("Este contacto ya tiene una gestión abierta de ese tipo.");
    if (existing.length > 0 && !confirmParallel) return setError("Confirma que quieres abrir otra gestión en paralelo.");
    setSaving(true);
    const res = await openManualCase({
      contactId: contact.id,
      caseTypeId: caseTypeId || null,
      assignee: mode === "person" ? personId : mode,
      scheduledFor: scheduling ? date : null,
      confirmParallel,
    });
    setSaving(false);
    if ("error" in res) return setError(res.error);
    onCreated({
      contactId: contact.id,
      caseId: res.caseId,
      status: res.status,
      scheduledFor: scheduling ? date : null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade-in fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-case-title"
        className="animate-pop-in relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <h2 id="new-case-title" className="text-base font-semibold">
            Nueva gestión
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Contacto */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Contacto</label>
            {contact ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{contact.displayName ?? "Desconocido"}</span>
                  {(contact.phone || contact.email) && (
                    <span className="ml-2 text-xs text-muted-foreground">{contact.phone || contact.email}</span>
                  )}
                </span>
                <button
                  onClick={() => setContact(null)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Busca por nombre, correo o teléfono..."
                    className={cn(FIELD_CLASS, "pl-9")}
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                <ul className="mt-1 max-h-44 overflow-auto rounded-lg border border-border">
                  {results.length === 0 && !searching ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No se encontraron contactos.</li>
                  ) : (
                    results.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => setContact(c)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="font-medium">{c.displayName ?? "Desconocido"}</span>
                          <span className="ml-2 truncate text-xs text-muted-foreground">{c.phone || c.email || ""}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>

          {contact && (
            <ParallelCaseWarning
              contactId={contact.id}
              existing={existing}
              caseTypeId={caseTypeId || null}
              confirmed={confirmParallel}
              onConfirmedChange={(value) => setConfirmedFor(value && contact ? contact.id : null)}
            />
          )}

          {/* Tipo */}
          <div>
            <label htmlFor="new-case-type" className="mb-1 block text-xs font-medium text-muted-foreground">
              Tipo de gestión
            </label>
            <select
              id="new-case-type"
              value={caseTypeId}
              onChange={(e) => setCaseTypeId(e.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">Sin clasificar</option>
              {caseTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Fecha */}
          <div>
            <label htmlFor="new-case-date" className="mb-1 block text-xs font-medium text-muted-foreground">
              Programar para (opcional)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-case-date"
                type="date"
                min={tomorrow}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={FIELD_CLASS}
              />
              {date && (
                <button onClick={() => setDate("")} className="text-xs text-muted-foreground underline hover:text-foreground">
                  Quitar
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {scheduling
                ? "Se activará ese día a las 09:00 y se asignará según el reparto."
                : "Sin fecha, la gestión se abre ahora."}
            </p>
          </div>

          {/* Asignación */}
          {!scheduling && (
            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-muted-foreground">Asignar a</legend>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="assign" checked={mode === "me"} onChange={() => setMode("me")} />
                  A mí
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="assign" checked={mode === "auto"} onChange={() => setMode("auto")} />
                  Automático (según el reparto)
                </label>
                {canAssignOthers && (
                  <label className="flex items-center gap-2">
                    <input type="radio" name="assign" checked={mode === "person"} onChange={() => setMode("person")} />
                    A otra persona
                  </label>
                )}
              </div>
              {mode === "person" && (
                <select
                  aria-label="Persona"
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className={cn(FIELD_CLASS, "mt-2")}
                >
                  <option value="">Elige una persona...</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </fieldset>
          )}

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || loadingExisting || hasSameTypeOpen(existing, caseTypeId || null)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {scheduling ? "Programar gestión" : "Abrir gestión"}
          </button>
        </div>
      </div>
    </div>
  );
}
