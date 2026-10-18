"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { archiveCaseType, removeCaseType, restoreCaseType, updateCaseType } from "@/lib/actions/case-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NAME_ERROR, cleanName } from "./config-rules";
import {
  ColorPicker,
  IconPicker,
  SaveBar,
  SectionTitle,
  Switch,
  inputClass,
  secondaryButtonClass,
  type TabProps,
} from "./shared";

export function GeneralTab({ type, data, run, busy, onGone }: TabProps & { onGone: () => void }) {
  const [name, setName] = useState(type.name);
  const [color, setColor] = useState(type.color);
  const [icon, setIcon] = useState(type.icon);
  const [isProactive, setIsProactive] = useState(type.isProactive);
  const [suggested, setSuggested] = useState<string[]>(type.suggestedForContactTypeIds);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "remove" | null>(null);

  const contactTypes = data.contactTypes.filter((c) => !c.archived || suggested.includes(c.id));
  const dirty =
    name !== type.name ||
    color !== type.color ||
    icon !== type.icon ||
    isProactive !== type.isProactive ||
    [...suggested].sort().join() !== [...type.suggestedForContactTypeIds].sort().join();

  function toggleSuggested(id: string) {
    setSuggested((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function save() {
    if (!cleanName(name)) {
      setLocalError(NAME_ERROR);
      return;
    }
    setLocalError(null);
    await run(
      () =>
        updateCaseType({
          id: type.id,
          name,
          color,
          icon,
          isProactive,
          suggestedForContactTypeIds: suggested,
        }),
      "Cambios guardados.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="case-type-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            Nombre
          </label>
          <div className="flex items-center gap-2">
            <ColorPicker value={color} onChange={setColor} disabled={busy} />
            <input
              id="case-type-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              disabled={busy}
              className={`${inputClass} flex-1`}
            />
          </div>
          {localError && <p className="mt-1 text-xs text-destructive">{localError}</p>}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Ícono</span>
          <IconPicker value={icon} onChange={setIcon} disabled={busy} />
        </div>

        <Switch
          checked={isProactive}
          onChange={setIsProactive}
          disabled={busy}
          label="Proactiva"
          hint="Las gestiones proactivas las crea una regla, una importación o una persona (por ejemplo, Recompra o Renovación) y aparecen en «Para hoy» el día que toca."
        />

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Se sugiere al abrir para estos tipos de contacto</legend>
          <p className="mb-2 text-xs text-muted-foreground">
            Cuando alguien escribe y no tiene una gestión abierta, se abre una de este tipo si su tipo de contacto está marcado.
          </p>
          {contactTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aún no hay tipos de contacto. Créalos en Configuración → Tipos de contacto.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {contactTypes.map((c) => (
                <label
                  key={c.id}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="checkbox"
                    checked={suggested.includes(c.id)}
                    onChange={() => toggleSuggested(c.id)}
                    disabled={busy}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color ?? "#9ca3af" }} />
                  <span className={c.archived ? "text-muted-foreground line-through" : ""}>{c.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <SaveBar dirty={dirty} busy={busy} onSave={save} />
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <SectionTitle
          title="Archivar o quitar este tipo"
          hint="Si el tipo ya tiene gestiones, se archiva: deja de ofrecerse, pero el historial y las métricas pasadas se conservan. Si nunca se usó, se borra."
        />
        <div className="flex flex-wrap gap-2">
          {type.archived ? (
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => run(() => restoreCaseType(type.id), "El tipo se reactivó.")}>
              <ArchiveRestore className="h-4 w-4" />
              Reactivar tipo
            </button>
          ) : (
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirm("archive")}>
              <Archive className="h-4 w-4" />
              Archivar tipo
            </button>
          )}
          <button type="button" className={`${secondaryButtonClass} text-destructive`} disabled={busy} onClick={() => setConfirm("remove")}>
            <Trash2 className="h-4 w-4" />
            Quitar tipo
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "archive"}
        title={`Archivar «${type.name}»`}
        message="Dejará de ofrecerse al abrir gestiones nuevas. Las gestiones abiertas siguen su curso y el historial se conserva. Puedes reactivarlo cuando quieras."
        confirmLabel="Archivar"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          if (await run(() => archiveCaseType(type.id), "El tipo se archivó.")) onGone();
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        title={`Quitar «${type.name}»`}
        message="Si tiene gestiones, o una regla o un equipo lo menciona, se archivará en lugar de borrarse. Si nunca se usó, se borrará con sus etapas, categorías, motivos y reglas."
        confirmLabel="Quitar"
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          if (await run(() => removeCaseType(type.id), (r) => r.message)) onGone();
        }}
      />
    </div>
  );
}
