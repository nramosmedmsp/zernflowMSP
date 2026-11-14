"use client";

// «Inscribir en secuencia» en la ficha del contacto (solo Dueño y Administrador; no
// aparece en un cliente eliminado). Elige una secuencia activa y el canal; la decisión
// de verdad la toma enrollContact en el servidor. También lista, solo lectura, las
// secuencias en las que ya está.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { enrollContact } from "@/lib/actions/sequences";
import { contactEnrollGate, defaultChannelId, type EnrollableContact } from "@/lib/sequences/enroll-gate";
import { platformLabel } from "@/lib/platforms";
import { Modal, primaryButtonClass, secondaryButtonClass, inputClass } from "@/components/inbox/ui";
import { useViewAs } from "@/components/view-as/view-as-context";
import { VIEW_AS_UNAVAILABLE_NOTE } from "@/lib/view-as/ui-rules";
import { useToast } from "@/components/ui/toast";

export interface EnrollSequenceOption {
  id: string;
  name: string;
  /** Ya tiene una inscripción activa en esta secuencia. */
  alreadyActive: boolean;
}

export interface ContactEnrollment {
  id: string;
  sequenceName: string;
  status: "active" | "completed" | "cancelled";
  enrolledAt: string;
}

const STATUS: Record<ContactEnrollment["status"], { label: string; classes: string }> = {
  active: { label: "Activa", classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  completed: { label: "Completada", classes: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  cancelled: { label: "Cancelada", classes: "bg-muted text-muted-foreground" },
};

export function EnrollInSequence({
  contactId,
  contact,
  channels,
  sequences,
  enrollments,
}: {
  contactId: string;
  contact: EnrollableContact;
  channels: { id: string; platform: string; label: string }[];
  /** Secuencias activas con pasos. */
  sequences: EnrollSequenceOption[];
  enrollments: ContactEnrollment[];
}) {
  const router = useRouter();
  const toast = useToast();
  const viewing = useViewAs().active;
  const [open, setOpen] = useState(false);
  const [sequenceId, setSequenceId] = useState("");
  const [channelId, setChannelId] = useState(defaultChannelId(channels));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = contactEnrollGate(contact, { channelCount: channels.length });
  const noSequences = sequences.length === 0;
  const reason = !gate.ok ? gate.message : noSequences ? "No hay secuencias activas. Activa una en Secuencias para poder inscribir." : null;
  const disabled = viewing || reason !== null;

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function confirm() {
    if (!sequenceId || !channelId) return;
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof enrollContact>>;
    try {
      res = await enrollContact(sequenceId, contactId, channelId);
    } catch {
      res = { error: "No se pudo inscribir. Revisa tu conexión e inténtalo de nuevo." };
    }
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    const name = sequences.find((s) => s.id === sequenceId)?.name ?? "la secuencia";
    toast.success(`Contacto ${"reactivated" in res && res.reactivated ? "reinscrito" : "inscrito"} en «${name}»`);
    setOpen(false);
    setSequenceId("");
    router.refresh();
  }

  return (
    <div className="space-y-3" data-testid="contact-sequences">
      {enrollments.length > 0 ? (
        <ul className="space-y-2">
          {enrollments.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{e.sequenceName}</p>
                <p className="text-xs text-muted-foreground">Inscrito el {formatDateTime(e.enrolledAt)}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS[e.status].classes)}>
                {STATUS[e.status].label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground/60">No está en ninguna secuencia</p>
      )}

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setChannelId(defaultChannelId(channels));
            setOpen(true);
          }}
          disabled={disabled}
          title={viewing ? VIEW_AS_UNAVAILABLE_NOTE : (reason ?? undefined)}
          className={cn(secondaryButtonClass, disabled && "cursor-not-allowed")}
          data-testid="enroll-in-sequence-button"
        >
          <UserPlus className="h-4 w-4" />
          Inscribir en secuencia
        </button>
        {reason && !viewing && (
          <p
            data-testid="enroll-disabled-reason"
            className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300"
          >
            <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {reason}
          </p>
        )}
        {viewing && (
          <p data-testid="view-as-unavailable-note" className="text-xs text-muted-foreground">
            {VIEW_AS_UNAVAILABLE_NOTE}
          </p>
        )}
      </div>

      <Modal
        open={open}
        title="Inscribir en secuencia"
        onClose={close}
        footer={
          <>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={close}>
              Cancelar
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy || !sequenceId || !channelId}
              onClick={() => void confirm()}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Inscribir
            </button>
          </>
        }
      >
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Secuencia (solo las activas)</legend>
          <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {sequences.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm",
                  s.alreadyActive ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent",
                  sequenceId === s.id && "bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="sequence"
                  value={s.id}
                  checked={sequenceId === s.id}
                  disabled={s.alreadyActive}
                  onChange={() => {
                    setSequenceId(s.id);
                    setError(null);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.alreadyActive && <span className="shrink-0 text-xs text-muted-foreground">Ya está inscrito</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Canal por el que recibirá la secuencia</span>
          {channels.length === 1 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {channels[0].label}
              {channels[0].platform ? <span className="text-muted-foreground"> · {platformLabel(channels[0].platform)}</span> : null}
            </p>
          ) : (
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Canal" className={inputClass}>
              <option value="">Elige un canal...</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label}
                  {ch.platform ? ` · ${platformLabel(ch.platform)}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
