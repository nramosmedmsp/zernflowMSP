"use client";

// Aviso «Parece un reclamo» (control de reclamos): el cliente escribió algo
// que suena a reclamo y no hay una gestión protegida abierta. Una persona lo
// confirma (abre la Postventa) o lo descarta.

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { dismissComplaintFlag, openComplaintCase, type ContactCasesView } from "@/lib/actions/cases";
import { complaintStillPending } from "@/lib/cases/protection";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

/** ¿Hay que mostrar el aviso? Marcado y sin una Postventa (protegida) abierta o posterior. */
export function showComplaintBanner(
  flaggedAt: string | null | undefined,
  data: Pick<ContactCasesView, "cases" | "recentClosed" | "caseTypes"> | null,
): boolean {
  if (!flaggedAt || !data) return false;
  const protectedIds = new Set(data.caseTypes.filter((t) => t.protected).map((t) => t.id));
  if (protectedIds.size === 0) return false;
  const protectedCases = [...data.cases, ...data.recentClosed]
    .filter((c) => c.caseTypeId && protectedIds.has(c.caseTypeId))
    .map((c) => ({ status: c.status, createdAt: c.createdAt, closedAt: c.closedAt }));
  return complaintStillPending(flaggedAt, protectedCases);
}

export function ComplaintBanner({
  excerpt,
  typeName = "Postventa",
  busy,
  onOpen,
  onDismiss,
}: {
  excerpt: string | null;
  typeName?: string;
  busy: "open" | "dismiss" | null;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 basis-48">
        <span className="font-medium">Parece un reclamo</span>
        {excerpt ? <>: «{excerpt}»</> : null}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={onOpen}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60",
          )}
        >
          {busy === "open" && <Loader2 className="h-3 w-3 animate-spin" />}
          Abrir {typeName}
        </button>
        <button
          onClick={onDismiss}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-background px-2.5 py-1 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:hover:bg-amber-950"
        >
          {busy === "dismiss" && <Loader2 className="h-3 w-3 animate-spin" />}
          No es un reclamo
        </button>
      </div>
    </div>
  );
}

/** El aviso ya conectado a las acciones del servidor. */
export function ComplaintBannerConnected({
  conversationId,
  excerpt,
  typeName,
  onChanged,
}: {
  conversationId: string;
  excerpt: string | null;
  typeName?: string;
  onChanged: (caseId?: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"open" | "dismiss" | null>(null);
  const toast = useToast();

  async function run(kind: "open" | "dismiss") {
    setBusy(kind);
    try {
      if (kind === "open") {
        const r = await openComplaintCase(conversationId);
        if ("error" in r) return toast.error(r.error);
        toast.success(r.classified ? `La gestión quedó clasificada como ${typeName ?? "Postventa"}.` : `Se abrió una ${typeName ?? "Postventa"}.`);
        await onChanged(r.caseId);
      } else {
        const r = await dismissComplaintFlag(conversationId);
        if ("error" in r) return toast.error(r.error);
        toast.success("Listo, no era un reclamo.");
        await onChanged();
      }
    } catch {
      toast.error("No se pudo completar la acción. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ComplaintBanner
      excerpt={excerpt}
      typeName={typeName}
      busy={busy}
      onOpen={() => void run("open")}
      onDismiss={() => void run("dismiss")}
    />
  );
}
