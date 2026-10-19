// El paso del tiempo: lo que haría el cron y el motor mientras corre el reloj.
// El cron real corre cada minuto (app/api/cron/jobs): primero reanuda los
// flujos con espera vencida y luego las tareas de gestiones (activar
// programadas, repartir, "cliente sin responder"). Aquí se procesa cada
// instante en que algo vence, en orden.

import { nextOpeningFor } from "@/lib/cases/hours";
import { WHATSAPP_WINDOW_MS } from "@/lib/flow-engine/send-mode";
import {
  activateScheduledCases,
  detectClientNoReply,
  formatDuration,
  nextNoReplyDue,
  noReplyThresholds,
  retryUnassignedCases,
} from "./cases";
import { drainEvents, resumeSession } from "./flows";
import type { Run } from "./run";
import { lastInboundAt } from "./state";

const MAX_TICKS = 2000;
const MAX_SAME_INSTANT = 5;

/** Un hecho que ocurre solo por el paso del tiempo (no cambia flujos): se anota en la traza. */
interface Passive {
  at: number;
  apply: (run: Run) => void;
}

function passiveEvents(run: Run, start: number, end: number): Passive[] {
  const out: Passive[] = [];
  const { state } = run;

  // Ventana de 24 h de WhatsApp.
  if (state.channel === "whatsapp") {
    const last = lastInboundAt(state);
    if (last) {
      const closes = new Date(last).getTime() + WHATSAPP_WINDOW_MS;
      if (closes > start && closes <= end) {
        out.push({
          at: closes,
          apply: (r) =>
            r.step("window_closed", "Se cierra la ventana de 24 h de WhatsApp: desde ahora el bot solo puede enviar plantillas aprobadas (un nodo sin plantilla no envía nada).", {
              level: "warning",
            }),
        });
      }
    }
  }

  // Esperas de respuesta que vencen.
  for (const session of state.sessions) {
    if (session.status === "active" && session.waitingForInput && session.waitingUntil) {
      const until = new Date(session.waitingUntil).getTime();
      if (until > start && until <= end) {
        out.push({
          at: until,
          apply: (r) => {
            const s = r.state.sessions.find((x) => x.id === session.id);
            if (!s || s.status !== "active" || !s.waitingForInput) return;
            s.status = "expired";
            s.waitingForInput = false;
            r.step("session_expired", `La espera de respuesta de «${r.index.flowById.get(s.flowId)?.name ?? s.flowId}» venció: si el cliente responde ahora, ya no retoma el flujo.`, {
              flowId: s.flowId,
              nodeId: s.currentNodeId ?? undefined,
              level: "warning",
            });
          },
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Próximo instante (> now, ≤ end) en que el cron tendría algo que hacer, o null. */
function nextDue(run: Run, end: number): number | null {
  const { state } = run;
  const now = run.now.getTime();
  const candidates: number[] = [];

  for (const job of state.jobs) {
    if (job.status === "pending") candidates.push(new Date(job.runAt).getTime());
  }
  for (const row of state.cases) {
    if (row.status === "scheduled" && row.scheduledFor) candidates.push(new Date(row.scheduledFor).getTime());
  }
  const thresholds = noReplyThresholds(run);
  if (thresholds.length > 0) {
    for (const row of state.cases) {
      const due = nextNoReplyDue(run, row, thresholds);
      if (due !== null) candidates.push(due);
    }
  }
  // Gestiones sin responsable que esperan a que abra el equipo.
  for (const row of state.cases) {
    if (row.status === "open" && !row.assigneeId) {
      const opening = nextOpeningFor(run.index.hours, row.teamId, run.now);
      if (opening && opening.getTime() > now) candidates.push(opening.getTime());
    }
  }

  // Lo que ya venció se procesa en este mismo instante; lo demás, cuando llegue.
  const upcoming = candidates.map((t) => Math.max(t, now)).filter((t) => t <= end);
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

/** Una vuelta del cron en el instante actual del reloj. */
function tick(run: Run): void {
  const nowMs = run.now.getTime();

  // 1. Reanudar los flujos cuya espera venció (/api/cron/jobs).
  const due = run.state.jobs
    .filter((j) => j.status === "pending" && new Date(j.runAt).getTime() <= nowMs)
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
  for (const job of due) {
    const session = run.state.sessions.find((s) => s.id === job.sessionId);
    if (!session || session.status !== "active" || session.currentNodeId !== job.nodeId) {
      job.status = "skipped";
      run.step("info", "Una espera venció, pero su flujo ya no está activo en ese nodo: no se reanuda.", { flowId: session?.flowId });
      continue;
    }
    job.status = "done";
    run.step("info", `Venció la espera del flujo «${run.index.flowById.get(session.flowId)?.name ?? session.flowId}»: el cron lo reanuda.`, {
      flowId: session.flowId,
      nodeId: job.nodeId,
    });
    resumeSession(run, session, { triggerId: "", flowId: session.flowId, incoming: {}, variables: {} });
  }

  // 2. Tareas de gestiones (runCaseTasks): activar programadas, repartir, cliente sin responder.
  activateScheduledCases(run);
  retryUnassignedCases(run);
  detectClientNoReply(run);

  // 3. Los eventos de gestión se ejecutan después (en el motor real, tras responder).
  drainEvents(run);
}

/** Avanza el reloj `minutes` minutos y aplica lo que haría el cron y el motor en ese intervalo. */
export function runAdvanceTime(run: Run, minutes: number): void {
  const start = run.now.getTime();
  const end = start + minutes * 60_000;
  run.step("time_advanced", `Pasan ${formatDuration(Math.round(minutes * 60))}.`, { data: { minutes, from: run.nowIso, to: new Date(end).toISOString() } });

  if (run.catalog.reassignAfterMinutes) {
    run.warn("El espacio reasigna gestiones por espera, pero el laboratorio no lo simula: no se reasigna nada.");
  }

  // El cron corre cada minuto: lo primero que hace es repartir las abiertas sin responsable (alguien volvió a estar disponible...).
  retryUnassignedCases(run);
  drainEvents(run);

  const passive = passiveEvents(run, start, end);
  let ticks = 0;
  let sameInstant = 0;
  let lastInstant = -1;

  const flushPassive = (upTo: number) => {
    while (passive.length > 0 && passive[0].at <= upTo) {
      const event = passive.shift()!;
      run.state.clock = new Date(Math.max(event.at, run.now.getTime())).toISOString();
      event.apply(run);
    }
  };

  for (;;) {
    const next = nextDue(run, end);
    if (next === null) break;
    if (ticks++ >= MAX_TICKS) {
      run.warn(`Se detiene el avance: más de ${MAX_TICKS} vueltas del cron seguidas (posible bucle).`);
      break;
    }
    sameInstant = next === lastInstant ? sameInstant + 1 : 0;
    lastInstant = next;
    if (sameInstant >= MAX_SAME_INSTANT) {
      run.warn("Se detiene el avance: algo vence una y otra vez en el mismo instante.");
      break;
    }
    flushPassive(next);
    run.state.clock = new Date(Math.max(next, run.now.getTime())).toISOString();
    tick(run);
  }

  flushPassive(end);
  run.state.clock = new Date(end).toISOString();
  // Las vencidas que quedaron sin procesar entre el último instante y el final (no debería haber).
  if (run.state.jobs.some((j) => j.status === "pending" && new Date(j.runAt).getTime() <= end)) tick(run);
}
