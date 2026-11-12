"use client";

import { useEffect } from "react";
import { APP_LOGO_URL, APP_NAME } from "@/lib/brand";

// Último recurso: falla el layout raíz. Renderiza su propio documento y NO recibe
// los estilos globales (ni Tailwind), por eso todo va en línea.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  const digest =
    error && typeof error === "object" && typeof (error as { digest?: unknown }).digest === "string"
      ? ((error as { digest: string }).digest as string)
      : null;

  return (
    <html lang="es">
      <head>
        <title>{`Algo salió mal | ${APP_NAME}`}</title>
        <style>{`
          :root { color-scheme: light dark; }
          body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; }
          .box { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
          .card { width: 100%; max-width: 384px; text-align: center; }
          .msg { margin: 24px 0; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; background: #f5f5f5; font-size: 14px; color: #555; }
          .row { display: flex; gap: 8px; flex-wrap: wrap; }
          .btn { flex: 1; min-width: 140px; padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; box-sizing: border-box; border: 1px solid #ccc; background: transparent; color: inherit; }
          .btn.main { background: #111; color: #fff; border-color: #111; }
          .dig { margin-top: 16px; font-size: 11px; color: #777; }
          @media (prefers-color-scheme: dark) {
            body { background: #0a0a0a; color: #f5f5f5; }
            .msg { background: #1a1a1a; border-color: #333; color: #aaa; }
            .btn { border-color: #444; }
            .btn.main { background: #f5f5f5; color: #111; border-color: #f5f5f5; }
            .dig { color: #888; }
          }
        `}</style>
      </head>
      <body>
        <div className="box" role="alert">
          <div className="card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={APP_LOGO_URL} alt={APP_NAME} width={48} height={48} style={{ objectFit: "contain" }} />
            <h1 style={{ fontSize: 24, margin: "12px 0 4px" }}>Algo salió mal</h1>
            <div style={{ fontSize: 14, color: "#777" }}>{APP_NAME}</div>
            <p className="msg">Algo salió mal. No se perdió lo que ya estaba guardado.</p>
            <div className="row">
              <button type="button" className="btn main" onClick={() => retry()}>
                Reintentar
              </button>
              <a className="btn" href="/dashboard/inbox">
                Volver a la Bandeja
              </a>
            </div>
            {digest && (
              <p className="dig">
                Prueba de nuevo. Si el problema sigue, avisa a soporte con este código: <code>{digest}</code>
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
