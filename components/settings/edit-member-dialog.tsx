"use client";

// "Editar usuario": nombre, correo y rol de una persona del equipo. Solo lo
// abre un Dueño (el servidor también lo exige). Siempre debe quedar al menos un
// Dueño: si esta persona es el único, sus opciones de rol quedan bloqueadas.

import { useState } from "react";
import Link from "next/link";
import { Ban, Loader2, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, Modal, inputClass } from "@/components/inbox/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  LAST_OWNER_MESSAGE,
  OWNER_PROMOTION_WARNING,
  SOLE_OWNER_NOTICE,
  teamsSummary,
  type TeamMemberView,
  type TeamRoleEntry,
} from "@/lib/team-rules";

export const ROLE_OPTIONS = [
  { value: "member", label: "Miembro", hint: "Trabaja en Bandeja, Gestiones y Contactos." },
  { value: "admin", label: "Administrador", hint: "Configura la tienda, flujos, canales y equipo." },
  { value: "owner", label: "Dueño", hint: "Todo, incluidas las claves, otros Dueños y «Ver como»." },
] as const;

export interface EditMemberInput {
  fullName: string;
  email: string;
  role: string;
}

export function EditMemberDialog({
  member,
  ownerCount,
  isSelf,
  teams,
  saving,
  onSave,
  onClose,
}: {
  member: TeamMemberView;
  ownerCount: number;
  isSelf: boolean;
  teams: readonly TeamRoleEntry[];
  saving: boolean;
  onSave: (input: EditMemberInput) => void;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(member.name);
  const [email, setEmail] = useState(member.email === "Sin correo" ? "" : member.email);
  const [role, setRole] = useState(member.role);
  const [confirmOwner, setConfirmOwner] = useState(false);

  // El único Dueño no puede dejar de serlo: Miembro y Administrador se bloquean.
  const lockedByRule = member.role === "owner" && ownerCount <= 1;
  const promoting = role === "owner" && member.role !== "owner";

  function submit() {
    if (saving) return;
    if (promoting) {
      setConfirmOwner(true);
      return;
    }
    onSave({ fullName, email, role });
  }

  return (
    <>
      <Modal
        open
        title="Editar usuario"
        onClose={() => {
          if (!confirmOwner && !saving) onClose();
        }}
        className="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !fullName.trim() || !email.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </>
        }
      >
        <Field label="Nombre">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={100}
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label="Correo" hint="Es el correo con el que inicia sesión. Si lo cambias, entrará con el nuevo.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Rol</span>
          <div role="radiogroup" aria-label="Rol" className="space-y-1.5">
            {ROLE_OPTIONS.map((o) => {
              const disabled = lockedByRule && o.value !== "owner";
              const checked = o.value === role;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-disabled={disabled}
                  disabled={disabled}
                  title={disabled ? LAST_OWNER_MESSAGE : undefined}
                  onClick={() => setRole(o.value)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm",
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                    disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      checked ? "border-primary" : "border-input",
                    )}
                  >
                    {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      {o.label}
                      {disabled && <Ban className="h-3 w-3" />}
                    </span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {lockedByRule ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {isSelf ? SOLE_OWNER_NOTICE : `${member.name} es el único Dueño: no puede dejar de serlo ni ser eliminado. Primero nombra a otro Dueño.`}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Siempre debe quedar al menos un Dueño.</p>
          )}
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <UsersRound className="h-3.5 w-3.5" />
          <span>Equipos: {teamsSummary(teams)}</span>
          <span>·</span>
          <Link
            href="/dashboard/settings/teams"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Cambiar en Equipos
          </Link>
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmOwner}
        title="Hacer Dueño"
        message={`${fullName.trim() || member.name} ${OWNER_PROMOTION_WARNING}`}
        confirmLabel="Hacer Dueño"
        cancelLabel="Cancelar"
        onConfirm={() => {
          setConfirmOwner(false);
          onSave({ fullName, email, role });
        }}
        onCancel={() => setConfirmOwner(false)}
      />
    </>
  );
}
