"use client";

// Historial de la gestión (⋯ → Historial): quién hizo qué y cuándo, en frases
// claras. `CaseHistoryList` solo pinta; `CaseHistoryDialog` lo carga del servidor.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { getCaseHistory, type CaseHistoryRow, type ContactCasesView } from "@/lib/actions/cases";
import { formatHistory, type HistoryItem, type HistoryLookup } from "./case-history-model";
import type { InboxMember } from "./inbox-model";
import { Modal, secondaryButtonClass } from "./ui";
import { useNow } from "./use-now";

export function CaseHistoryList({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay movimientos en esta gestión.</p>;
  }
  return (
    <ol className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-2">
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
          <span className="min-w-0 flex-1 text-sm leading-snug">{item.text}</span>
          <span className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-muted-foreground">{item.when}</span>
        </li>
      ))}
    </ol>
  );
}

export function historyLookup(data: ContactCasesView, members: readonly InboxMember[]): HistoryLookup {
  return {
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    caseTypes: data.caseTypes,
    teams: data.teams,
  };
}

export function CaseHistoryDialog({
  caseId,
  data,
  members,
  onClose,
}: {
  caseId: string;
  data: ContactCasesView;
  members: readonly InboxMember[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CaseHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    getCaseHistory(caseId)
      .then((r) => {
        if (cancelled) return;
        if ("error" in r) setError(r.error);
        else setRows(r.rows);
      })
      .catch(() => !cancelled && setError("No se pudo cargar el historial. Inténtalo de nuevo."));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const items = useMemo(
    () => (rows && now !== null ? formatHistory(rows, historyLookup(data, members), new Date(now)) : null),
    [rows, now, data, members],
  );

  return (
    <Modal
      open
      title="Historial de la gestión"
      onClose={onClose}
      className="max-w-lg"
      footer={
        <button onClick={onClose} className={secondaryButtonClass}>
          Cerrar
        </button>
      }
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items ? (
        <CaseHistoryList items={items} />
      ) : (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Cargando" />
        </div>
      )}
    </Modal>
  );
}
