"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  archiveContactType,
  createContactType,
  removeContactType,
  reorderContactTypes,
  restoreContactType,
  saveKeyDateLabel,
  setDefaultContactType,
  updateContactType,
} from "@/lib/actions/case-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { KEY_DATE_LABEL_SUGGESTIONS, cleanKeyDateLabel, moveId, type CaseConfigData, type ContactTypeConfig } from "./config-rules";
import {
  AddForm,
  ArchivedRow,
  ColorPicker,
  ListRow,
  NoticeBox,
  SectionTitle,
  inputClass,
  primaryButtonClass,
  useRunner,
} from "./shared";

type Pending = { type: ContactTypeConfig; mode: "archive" | "delete" };

function KeyDateLabelForm({ initial, busy, onSave }: { initial: string; busy: boolean; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = label.trim().replace(/\s+/g, " ") !== initial;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (cleanKeyDateLabel(label) === undefined) {
      setError("Escribe una etiqueta de hasta 100 caracteres.");
      return;
    }
    setError(null);
    onSave(label);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="key-date-label" className="block text-xs font-medium text-muted-foreground">
        Etiqueta de la fecha clave
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="key-date-label"
          list="key-date-suggestions"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          disabled={busy}
          placeholder="Por ejemplo, Última compra"
          className={`${inputClass} min-w-[14rem] flex-1 sm:max-w-sm`}
        />
        <datalist id="key-date-suggestions">
          {KEY_DATE_LABEL_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button type="submit" disabled={busy || !dirty} className={primaryButtonClass}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar etiqueta
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Cada contacto puede tener una fecha clave (la última compra, el vencimiento de la membresía…). Es el nombre con el que se muestra esa fecha.
      </p>
    </form>
  );
}

export function ContactTypesView({ data }: { data: CaseConfigData }) {
  const { run, busy, notice, clearNotice } = useRunner();
  const [showArchived, setShowArchived] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const sorted = [...data.contactTypes].sort((a, b) => a.position - b.position);
  const active = sorted.filter((t) => !t.archived);
  const archived = sorted.filter((t) => t.archived);
  const activeIds = active.map((t) => t.id);

  async function confirmPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.mode === "archive") {
      await run(() => archiveContactType(p.type.id), (r) => `Se archivó «${p.type.name}».${p.type.isDefault ? " Ya no hay un tipo por defecto: elige otro." : ""}${r.warning ? ` ${r.warning}` : ""}`);
    } else {
      await run(() => removeContactType(p.type.id), (r) => r.message);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Volver a Configuración">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Tipos de contacto</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Quién es cada contacto: prospecto, cliente, socio… Cambia poco con el tiempo.</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {notice && <NoticeBox notice={notice} onClose={clearNotice} />}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle title="Tipos de contacto" hint="El que está por defecto se asigna a los contactos nuevos. Solo puede haber uno." />
              {archived.length > 0 && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" />
                  Ver archivados ({archived.length})
                </label>
              )}
            </div>

            <ul className="space-y-1.5">
              {active.map((t, i) => (
                <ListRow
                  key={`${t.id}:${t.updatedAt}`}
                  name={t.name}
                  nameLabel={`Nombre del tipo de contacto ${t.name}`}
                  lead={
                    <ColorPicker
                      value={t.color}
                      disabled={busy}
                      label={`Color de ${t.name}`}
                      onChange={(color) => run(() => updateContactType({ id: t.id, color }))}
                    />
                  }
                  extra={
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="radio"
                        name="default-contact-type"
                        checked={t.isDefault}
                        disabled={busy}
                        onChange={() => run(() => setDefaultContactType(t.id), `«${t.name}» es ahora el tipo por defecto.`)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      Por defecto
                    </label>
                  }
                  canUp={i > 0}
                  canDown={i < active.length - 1}
                  onUp={() => run(() => reorderContactTypes(moveId(activeIds, t.id, "up")))}
                  onDown={() => run(() => reorderContactTypes(moveId(activeIds, t.id, "down")))}
                  onRename={(name) => run(() => updateContactType({ id: t.id, name }))}
                  onArchive={() => setPending({ type: t, mode: "archive" })}
                  onRemove={() => setPending({ type: t, mode: "delete" })}
                  disabled={busy}
                />
              ))}
              {active.length === 0 && <li className="text-xs text-muted-foreground">Aún no hay tipos de contacto.</li>}
            </ul>

            <AddForm
              placeholder="Nombre del tipo de contacto nuevo"
              disabled={busy}
              onAdd={(name) => run(() => createContactType({ name, color: "#3b82f6" }), `Tipo de contacto «${name}» agregado.`)}
            />

            {active.length > 0 && !active.some((t) => t.isDefault) && (
              <p className="text-xs text-muted-foreground">
                Ningún tipo está por defecto.{" "}
                <button type="button" className="underline hover:text-foreground" disabled={busy} onClick={() => run(() => setDefaultContactType(active[0].id), `«${active[0].name}» es ahora el tipo por defecto.`)}>
                  Usar «{active[0].name}»
                </button>
              </p>
            )}

            {showArchived && archived.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Archivados</h4>
                <ul className="space-y-1.5">
                  {archived.map((t) => (
                    <ArchivedRow
                      key={t.id}
                      name={t.name}
                      disabled={busy}
                      onRestore={() => run(() => restoreContactType(t.id), `El tipo «${t.name}» se reactivó.`)}
                      onRemove={() => setPending({ type: t, mode: "delete" })}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="border-t border-border pt-6">
            <KeyDateLabelForm
              key={data.keyDateLabel}
              initial={data.keyDateLabel}
              busy={busy}
              onSave={(label) => run(() => saveKeyDateLabel(label), "Etiqueta guardada.")}
            />
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${pending.mode === "archive" ? "Archivar" : "Quitar"} «${pending.type.name}»` : ""}
        message={
          pending?.mode === "archive"
            ? "Dejará de ofrecerse, pero los contactos que ya lo tienen lo conservan. Puedes reactivarlo cuando quieras."
            : "Si algún contacto lo tiene, o una regla o un tipo de gestión lo menciona, se archivará en lugar de borrarse. Si nunca se usó, se borrará."
        }
        confirmLabel={pending?.mode === "archive" ? "Archivar" : "Quitar"}
        destructive={pending?.mode === "delete"}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />
    </div>
  );
}
