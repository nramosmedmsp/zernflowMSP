"use client";

// «Inscribir contacto» (pantalla de la secuencia, solo Dueño y Administrador): busca un
// contacto, muestra su estado de publicidad y, si puede recibir la secuencia, deja elegir
// el canal. Quien no aceptó publicidad sale bloqueado con el motivo (igual que el candado de
// las plantillas). La decisión de verdad la toma enrollContact en el servidor.

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchContacts, type ContactSearchResult } from "@/lib/actions/contacts";
import { enrollContact } from "@/lib/actions/sequences";
import { marketingStatusLabel, type MarketingStatus } from "@/lib/consent";
import { contactEnrollGate, defaultChannelId, enrollConsentStatus } from "@/lib/sequences/enroll-gate";
import { platformLabel } from "@/lib/platforms";
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/inbox/ui";
import { useToast } from "@/components/ui/toast";

const CHIP: Record<MarketingStatus, string> = {
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  unknown: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  opted_out: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function resultGate(c: ContactSearchResult) {
  return contactEnrollGate(
    { marketing_status: c.marketingStatus, is_subscribed: c.isSubscribed },
    { channelCount: c.channels?.length ?? 0 },
  );
}

export function EnrollContactDialog({
  open,
  sequenceId,
  sequenceName,
  onClose,
  onEnrolled,
}: {
  open: boolean;
  sequenceId: string;
  sequenceName: string;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<{ query: string; list: ContactSearchResult[] } | null>(null);
  const [selected, setSelected] = useState<ContactSearchResult | null>(null);
  const [channelId, setChannelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Búsqueda con espera, descartando respuestas viejas (la misma acción que «Nueva gestión»).
  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      let list: ContactSearchResult[] = [];
      try {
        const res = await searchContacts(query);
        list = "error" in res ? [] : res.contacts;
      } catch {
        // Sin conexión: lista vacía en vez de dejar «Buscando…».
      }
      if (mine !== seq.current) return;
      setLoaded({ query, list });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);

  function choose(c: ContactSearchResult) {
    setSelected(c);
    setChannelId(defaultChannelId(c.channels ?? []));
    setError(null);
  }

  function close() {
    if (busy) return;
    setQuery("");
    setLoaded(null);
    setSelected(null);
    setChannelId("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!selected || !channelId) return;
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof enrollContact>>;
    try {
      res = await enrollContact(sequenceId, selected.id, channelId);
    } catch {
      res = { error: "No se pudo inscribir. Revisa tu conexión e inténtalo de nuevo." };
    }
    setBusy(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    toast.success(
      `${selected.displayName || "El contacto"} quedó ${"reactivated" in res && res.reactivated ? "reinscrito" : "inscrito"} en la secuencia`,
    );
    setQuery("");
    setLoaded(null);
    setSelected(null);
    setChannelId("");
    onClose();
    onEnrolled();
  }

  const searching = loaded?.query !== query;
  const results = loaded?.list ?? [];
  const channels = selected?.channels ?? [];

  return (
    <Modal
      open={open}
      title="Inscribir contacto"
      onClose={close}
      className="max-w-lg"
      footer={
        <>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || !selected || !channelId}
            onClick={() => void confirm()}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Inscribir
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Inscribe a mano a un contacto en <span className="font-medium text-foreground">«{sequenceName}»</span>. Solo
        se puede inscribir a quien aceptó recibir publicidad.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setChannelId("");
            setError(null);
          }}
          placeholder="Buscar por nombre, teléfono o correo"
          aria-label="Buscar contacto"
          className={cn(inputClass, "pl-9")}
          autoFocus
        />
      </div>

      <div
        className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border"
        data-testid="enroll-results"
      >
        {searching && results.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">Buscando...</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No se encontraron contactos.</p>
        ) : (
          results.map((c) => {
            const gate = resultGate(c);
            const status = enrollConsentStatus({ marketing_status: c.marketingStatus, is_subscribed: c.isSubscribed });
            const isSelected = selected?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={!gate.ok}
                aria-pressed={isSelected}
                onClick={() => choose(c)}
                className={cn(
                  "block w-full px-3 py-2 text-left transition-colors",
                  gate.ok ? "hover:bg-accent" : "cursor-not-allowed",
                  isSelected && "bg-accent",
                )}
              >
                <div className={cn("flex items-center gap-2", !gate.ok && "opacity-70")}>
                  {!gate.ok && <Lock className="h-3 w-3 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.displayName || c.phone || c.email || "Sin nombre"}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", CHIP[status])}>
                    {marketingStatusLabel(status)}
                  </span>
                </div>
                {(c.phone || c.email) && (
                  <p className={cn("truncate text-xs text-muted-foreground", !gate.ok && "opacity-70")}>
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </p>
                )}
                {!gate.ok && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{gate.message}</p>}
              </button>
            );
          })
        )}
      </div>

      {selected && (
        <div className="space-y-1.5" data-testid="enroll-channel">
          <span className="text-xs font-medium text-muted-foreground">Canal por el que recibirá la secuencia</span>
          {channels.length === 1 ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {channels[0].label}
              {channels[0].platform ? <span className="text-muted-foreground"> · {platformLabel(channels[0].platform)}</span> : null}
            </p>
          ) : (
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label="Canal"
              className={inputClass}
            >
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
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Modal>
  );
}
