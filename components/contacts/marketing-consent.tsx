"use client";

// Estado de publicidad de un contacto (PRIV-04): si aceptó recibir publicidad, desde
// cuándo y cómo se anotó, y los botones "Registrar consentimiento", "Dar de baja de
// publicidad" y "Reactivar". Lo usan el panel del contacto de la Bandeja y la ficha.
// Cualquier asesor que vea al contacto puede usarlo; cada cambio queda en el
// historial del contacto (lo hace la acción del servidor).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { setMarketingConsent } from "@/lib/actions/contacts";
import {
  CONSENT_ACTION_LABELS,
  availableConsentActions,
  marketingSourceLabel,
  marketingStatusLabel,
  normalizeMarketingStatus,
  type ConsentAction,
  type MarketingStatus,
} from "@/lib/consent";
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
import { useViewAs } from "@/components/view-as/view-as-context";
import { VIEW_AS_UNAVAILABLE_NOTE } from "@/lib/view-as/ui-rules";
import { useToast } from "@/components/ui/toast";

const CHIP: Record<MarketingStatus, string> = {
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  unknown: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  opted_out: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const EXPLAIN: Record<ConsentAction, string> = {
  accept:
    "Anota que el cliente aceptó recibir publicidad (ofertas, difusiones y secuencias). Quedará guardado con la fecha, que lo anotaste tú y la nota que escribas.",
  opt_out:
    "El cliente dejará de recibir difusiones, secuencias y plantillas de publicidad. Podrás seguir respondiéndole en el chat y enviándole avisos de servicio (pedido, pago, entrega).",
  reactivate:
    "Úsalo solo si el cliente volvió a pedir publicidad. Anota cómo y cuándo lo dijo: queda como evidencia en su historial.",
};

export interface MarketingConsentProps {
  contactId: string;
  status: string | null | undefined;
  at: string | null | undefined;
  source: string | null | undefined;
  note: string | null | undefined;
  /** Nombre de quien lo anotó, si se conoce. */
  setByName?: string | null;
  /** Los datos del cliente fueron eliminados: ya no se puede cambiar. */
  erased?: boolean;
  /** Versión angosta (panel lateral de la Bandeja). */
  compact?: boolean;
  /** Se llama después de guardar, para que la pantalla recargue el contacto (sin él se recarga la página). */
  onChanged?: () => void;
  className?: string;
}

export function MarketingConsentBlock({
  contactId,
  status,
  at,
  source,
  note,
  setByName,
  erased = false,
  compact = false,
  onChanged,
  className,
}: MarketingConsentProps) {
  const toast = useToast();
  const viewing = useViewAs().active;
  const router = useRouter();
  const current = normalizeMarketingStatus(status);
  const [pending, setPending] = useState<ConsentAction | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = erased ? [] : availableConsentActions(current);
  const sourceText = marketingSourceLabel(source);
  const detail = [
    current === "unknown" ? null : at ? `desde ${formatDateTime(at)}` : null,
    current === "unknown" ? null : sourceText,
    current !== "unknown" && setByName ? `por ${setByName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function open(action: ConsentAction) {
    setPending(action);
    setText("");
    setError(null);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof setMarketingConsent>>;
    try {
      result = await setMarketingConsent(contactId, pending, text);
    } catch {
      result = { error: "No se pudo guardar el cambio. Inténtalo de nuevo." };
    }
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    toast.success(
      pending === "opt_out" ? "El cliente quedó de baja de la publicidad" : "Consentimiento de publicidad registrado",
    );
    setPending(null);
    if (onChanged) onChanged();
    else router.refresh();
  }

  const needsNote = pending === "reactivate";

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn("flex flex-wrap items-center gap-2", compact && "justify-center")}>
        <span className="inline-flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
          <Megaphone className="h-3 w-3" />
          Publicidad
        </span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", CHIP[current])}>
          {erased ? "Datos eliminados" : marketingStatusLabel(current)}
        </span>
      </div>
      {current === "unknown" && !erased && (
        <p className={cn("text-xs text-muted-foreground", compact && "text-center")}>
          Nadie anotó que aceptó. Puedes atenderlo, pero no enviarle publicidad.
        </p>
      )}
      {detail && <p className={cn("text-xs text-muted-foreground", compact && "text-center")}>{detail}</p>}
      {note && current !== "unknown" && (
        <p className={cn("text-xs italic text-muted-foreground", compact && "text-center")}>«{note}»</p>
      )}
      {actions.length > 0 && (
        <div className={cn("flex flex-wrap gap-2", compact && "justify-center")}>
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => open(action)}
              disabled={viewing}
              title={viewing ? VIEW_AS_UNAVAILABLE_NOTE : undefined}
              className={cn(
                action === "opt_out" ? secondaryButtonClass : primaryButtonClass,
                "px-2.5 py-1 text-xs",
                viewing && "cursor-not-allowed",
              )}
            >
              {CONSENT_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}
      {viewing && actions.length > 0 && (
        <p
          data-testid="view-as-unavailable-note"
          className={cn("text-xs text-muted-foreground", compact && "text-center")}
        >
          {VIEW_AS_UNAVAILABLE_NOTE}
        </p>
      )}

      <Modal
        open={pending !== null}
        title={pending ? CONSENT_ACTION_LABELS[pending] : ""}
        onClose={() => (busy ? undefined : setPending(null))}
        footer={
          <>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setPending(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy || (needsNote && text.trim().length < 5)}
              onClick={() => void confirm()}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar
            </button>
          </>
        }
      >
        {pending && <p className="text-sm text-muted-foreground">{EXPLAIN[pending]}</p>}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {needsNote ? "Cómo y cuándo volvió a aceptar (obligatorio)" : "Nota (opcional)"}
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={
              pending === "accept"
                ? "Ej.: Lo aceptó por teléfono el 12/11 al comprar"
                : pending === "opt_out"
                  ? "Ej.: Pidió no recibir más ofertas"
                  : "Ej.: Escribió por WhatsApp el 12/11 pidiendo promociones"
            }
            className={inputClass}
          />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Modal>
    </div>
  );
}
