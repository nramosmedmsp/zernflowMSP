"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { sameTypeConfirmMessage } from "@/lib/cases/parallel";

export interface ParallelCase {
  id: string;
  caseTypeId: string | null;
  caseTypeName: string;
  status: "open" | "scheduled";
}

/**
 * ¿Hay una gestión del mismo tipo (o ambas sin clasificar) que impide abrir otra?
 * Si el tipo admite paralelas (`sameTypeAllowed`: Venta, Recompra) no se bloquea:
 * se pide confirmar.
 */
export function hasSameTypeOpen(
  existing: readonly ParallelCase[],
  caseTypeId: string | null,
  sameTypeAllowed = false,
): boolean {
  if (sameTypeAllowed && caseTypeId) return false;
  return existing.some((c) => c.caseTypeId === caseTypeId);
}

/**
 * Aviso de «Nueva gestión» cuando el contacto ya tiene gestiones abiertas:
 * las lista con «Ir a la gestión» y pide confirmar. Del mismo tipo solo deja
 * continuar si el tipo admite paralelas (`sameTypeAllowed`).
 */
export function ParallelCaseWarning({
  contactId,
  existing,
  caseTypeId,
  confirmed,
  onConfirmedChange,
  sameTypeAllowed = false,
}: {
  contactId: string;
  existing: readonly ParallelCase[];
  caseTypeId: string | null;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  /** El tipo elegido admite otra gestión igual con confirmación. */
  sameTypeAllowed?: boolean;
}) {
  if (existing.length === 0) return null;
  const blocked = hasSameTypeOpen(existing, caseTypeId, sameTypeAllowed);
  const sameType = caseTypeId ? existing.find((c) => c.caseTypeId === caseTypeId) : undefined;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
      <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {existing.length === 1 ? "Este contacto ya tiene una gestión abierta" : `Este contacto ya tiene ${existing.length} gestiones abiertas`}
      </p>
      <ul className="mt-2 space-y-1">
        {existing.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
            <span>
              {c.caseTypeName} · {c.status === "scheduled" ? "programada" : "abierta"}
            </span>
            <Link
              href={`/dashboard/inbox?contact=${encodeURIComponent(contactId)}&case=${encodeURIComponent(c.id)}`}
              className="font-medium text-primary underline"
            >
              Ir a la gestión
            </Link>
          </li>
        ))}
      </ul>
      {blocked ? (
        <p className="mt-2 text-xs text-red-600">
          Ya hay una gestión de ese tipo. Ve a esa gestión, o elige otro tipo para abrir una distinta.
        </p>
      ) : (
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirmedChange(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {sameType ? sameTypeConfirmMessage(sameType.caseTypeName) : "Quiero abrir otra gestión en paralelo, aunque ya tenga una abierta."}
          </span>
        </label>
      )}
    </div>
  );
}
