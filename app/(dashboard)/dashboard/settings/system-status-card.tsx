import { CheckCircle2, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { isDailyCron, type SystemStatus } from "@/lib/system-status";

/** Estado del sistema: última ejecución de cada tarea automática y mensajes que no se pudieron procesar. */
export function SystemStatusCard({ status }: { status: SystemStatus }) {
  const allFresh = status.crons.filter((c) => !isDailyCron(c.name)).every((c) => c.fresh);
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="system-status-title">
      <div className="flex items-center gap-2">
        {allFresh && status.failedTotal === 0 ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        )}
        <h2 id="system-status-title" className="text-sm font-semibold">
          Estado del sistema
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Dos tareas corren cada minuto y dos limpiezas una vez al día. Si una no termina bien a tiempo (5 minutos las de cada minuto, 36 horas las diarias), aparece en rojo.
      </p>

      <ul className="mt-3 space-y-2 text-sm">
        {status.crons.map((c) => (
          <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <div>
              <p>{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
            </div>
            {/* Las limpiezas diarias que aún no corrieron no son un problema; las demás sí lo son. */}
            <span className={`ml-auto text-right ${c.fresh || (isDailyCron(c.name) && !c.lastOkAt) ? "text-muted-foreground" : "font-medium text-red-600"}`}>
              {c.lastOkAt ? `Última vez bien: ${formatDateTime(c.lastOkAt)}` : "Aún no se ha ejecutado"}
              {!c.fresh && c.lastError ? ` · Último error: ${c.lastError}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-border pt-3 text-sm">
        {status.failedTotal === 0 && status.pendingEvents === 0 ? (
          <p className="text-muted-foreground">No hay mensajes de clientes sin procesar.</p>
        ) : (
          <>
            {status.pendingEvents > 0 && (
              <p className="text-muted-foreground">
                {status.pendingEvents} mensaje(s) de clientes se están reintentando solos.
              </p>
            )}
            {status.failedTotal > 0 && (
              <>
                <p className="font-medium text-red-600">
                  {status.failedTotal} mensaje(s) de clientes no se pudieron procesar en los últimos 7 días. Revisa esas
                  conversaciones en la Bandeja y asigna la gestión a mano si hace falta.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {status.failedEvents.map((e) => (
                    <li key={e.eventId}>
                      {formatDateTime(e.receivedAt)} · {e.attempts} intentos{e.lastError ? ` · ${e.lastError}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
