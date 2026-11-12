"use client";

import { useEffect } from "react";
import { BrandLogo } from "@/lib/brand-logo";
import { APP_NAME } from "@/lib/brand";

export const ERROR_TITLE = "Algo salió mal";
export const ERROR_MESSAGE = "Algo salió mal. No se perdió lo que ya estaba guardado.";
export const ERROR_HINT = "Prueba de nuevo. Si el problema sigue, avisa a soporte con este código:";
export const RETRY_LABEL = "Reintentar";
export const INBOX_LABEL = "Volver a la Bandeja";
export const INBOX_PATH = "/dashboard/inbox";

/** `digest` solo existe en errores del servidor; el texto del error nunca se muestra. */
function digestOf(error: unknown): string | null {
  if (error && typeof error === "object" && "digest" in error) {
    const d = (error as { digest?: unknown }).digest;
    return typeof d === "string" && d ? d : null;
  }
  return null;
}

/**
 * Pantalla de error de la app (CONF-01 / OPE-08). Sin detalles técnicos: solo el
 * código `digest` en pequeño para soporte. `retry` vuelve a pedir los datos al
 * servidor (un `reset` a secas no lo haría); `compact` es la versión dentro del
 * panel, que deja visible el menú lateral.
 */
export function ErrorScreen({
  error,
  retry,
  compact = false,
}: {
  error: unknown;
  retry: () => void;
  compact?: boolean;
}) {
  useEffect(() => {
    // En el navegador queda el rastro; el error del servidor ya está en los registros con este mismo digest.
    console.error("[error-screen]", error);
  }, [error]);

  const digest = digestOf(error);

  return (
    <div
      role="alert"
      className={
        compact
          ? "flex h-full min-h-[60vh] items-center justify-center overflow-auto px-4 py-8"
          : "flex min-h-screen items-center justify-center px-4"
      }
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{ERROR_TITLE}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{APP_NAME}</p>
        </div>

        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          {ERROR_MESSAGE}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => retry()}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {RETRY_LABEL}
          </button>
          {/* <a> y no <Link>: si el enrutador falló, una navegación completa siempre sale del error. */}
          <a
            href={INBOX_PATH}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium hover:bg-accent"
          >
            {INBOX_LABEL}
          </a>
        </div>

        {digest && (
          <p className="text-center text-[11px] text-muted-foreground">
            {ERROR_HINT} <span className="font-mono">{digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
