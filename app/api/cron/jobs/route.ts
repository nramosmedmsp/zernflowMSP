import { isCronAuthorized } from "@/lib/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { FlowLoadError, resumeSession } from "@/lib/flow-engine/engine";
import { shouldCancelResumeForPausedBot } from "@/lib/flow-engine/waiting-session";
import type { Json } from "@/lib/types/database";
import { runCaseTasks } from "@/lib/cases";
import { recordCronEnd, recordCronStart } from "@/lib/cron-runs";
import { pruneWebhookEvents, sweepInboundEvents, sweepOrphanChats } from "@/lib/inbound-events";
import { BROADCAST_START_LIMIT_MS, OTHER_JOBS_START_LIMIT_MS } from "@/lib/broadcasts/pacing";
import { runBroadcastSendPass } from "@/lib/broadcasts/send-pass";

export const maxDuration = 60;

// CONF-03: presupuesto de tiempo de una pasada (maxDuration = 60 s). Lo que
// importa para el negocio va primero y con su propio tope, y la cola de envíos
// usa el tiempo que quede, de modo que una cola lenta (Zernio tardando) nunca
// deje sin correr las tareas de gestiones ni la recuperación de mensajes:
//   1. recuperar mensajes entrantes pendientes ......... hasta 8 s
//   2. tareas de gestiones (programadas, plazos, reclamos, reasignación) hasta 15 s
//   3. trabajos programados (esperas de flujos...): no se empieza uno nuevo
//      pasados 25 s, para dejar siempre tiempo a las difusiones;
//   4. envíos de difusión, con su PROPIA porción (CONF-04/05): un máximo de envíos
//      por pasada y sin empezar ninguno pasados 35 s, porque un envío a Zernio
//      puede tardar hasta 20 s y hay que terminar antes de los 60 s. Su ritmo y su
//      razón están en lib/broadcasts/pacing.ts. Una difusión grande nunca deja sin
//      correr lo anterior, y lo anterior nunca la deja sin su turno completo en
//      una pasada normal.
// Lo que no alcance queda pendiente para la siguiente pasada (todo es idempotente).
const INBOUND_SWEEP_BUDGET_MS = 8_000;
const CASE_TASKS_BUDGET_MS = 15_000;
/** El barrido de chats sin gestión es más caro: una vez cada 5 minutos. */
const ORPHAN_SWEEP_EVERY_MINUTES = 5;
const JOBS_BATCH = 20;

// Signals the handler to skip retry/backoff and route straight to the
// failed + settle branch (which performs/re-attempts the session cancel).
// Thrown when (a) a resume failed AND the cancel of its session also failed
// (requeuing would strand the session: the retry hits the stale-node guard
// and completes the job), or (b) a reclaimed job found its session stranded
// by a resume invocation that died mid-traversal (retrying cannot help; the
// session must be cancelled and the job is the only evidence of the crash).
class SessionCancelError extends Error {}

// Thrown when a reclaimed job finds its session moved past the delay node and
// not parked, but WRITTEN TO within the stale window: either a concurrent
// webhook resume is mid-traversal (traverseNodes stamps current_node_id, and
// the updated_at trigger fires, on every node) or a resume crashed moments
// ago. The two are indistinguishable right now, and cancelling would kill a
// live run, so the job is requeued past the window and the next look decides.
class SessionRecheckError extends Error {}

// An invocation that has not written anything for this long is provably dead:
// used both to reclaim stale job claims and to age flow_sessions.updated_at.
const STALE_INVOCATION_MS = 5 * 60 * 1000;

function wasSessionWrittenRecently(updatedAt: string): boolean {
  return new Date(updatedAt).getTime() > Date.now() - STALE_INVOCATION_MS;
}

/**
 * Cron job handler that processes scheduled jobs.
 * Call via Vercel Cron or external cron every 10-30 seconds.
 * GET /api/cron/jobs con la cabecera Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = await createServiceClient();
  await recordCronStart(supabase, "jobs");

  try {
    const { status, body } = await runJobsCron(supabase, startedAt);
    const error = "error" in body && typeof body.error === "string" ? body.error : null;
    await recordCronEnd(supabase, "jobs", { startedAt, error, stats: error ? null : summarize(body) });
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("Cron jobs failed:", err);
    await recordCronEnd(supabase, "jobs", {
      startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** Solo conteos (sin datos de personas) para cron_runs.last_stats. */
function summarize(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["processed", "failed", "total", "skippedForTime", "inbound", "orphans", "broadcasts"]) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

async function runJobsCron(
  supabase: ServiceClient,
  startedAt: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Poda de la bandeja de entrada de webhooks: lo procesado a las 48 h (solo
  // sirve para reconocer los reintentos de Zernio) y lo demás a los 7 días.
  await pruneWebhookEvents(supabase);

  // 1. Mensajes entrantes que no terminaron de procesarse (CONF-06/07): se retoman
  // los pendientes y, cada 5 minutos, los chats con mensaje reciente sin gestión.
  let inbound: Record<string, unknown> | { error: string };
  let orphans: Record<string, unknown> | { error: string } | undefined;
  const inboundDeadline = Date.now() + INBOUND_SWEEP_BUDGET_MS;
  try {
    if (Math.floor(Date.now() / 60_000) % ORPHAN_SWEEP_EVERY_MINUTES === 0) {
      orphans = await sweepOrphanChats(supabase, { deadline: inboundDeadline });
    }
  } catch (err) {
    console.error("Orphan chats sweep error:", err);
    orphans = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    inbound = { ...(await sweepInboundEvents(supabase, { deadline: inboundDeadline })) };
  } catch (err) {
    console.error("Inbound sweep error:", err);
    inbound = { error: err instanceof Error ? err.message : String(err) };
  }

  // 2. Gestiones (docs/FASE-1-TECNICO.md 3.5): activar programadas, avisar
  // próximos contactos vencidos y reintentar el reparto. Van antes que la cola
  // de envíos y con su propio tope de tiempo.
  let cases: Awaited<ReturnType<typeof runCaseTasks>> | { error: string };
  try {
    cases = await runCaseTasks(supabase, { deadline: Date.now() + CASE_TASKS_BUDGET_MS });
  } catch (err) {
    console.error("Case tasks error:", err);
    cases = { error: err instanceof Error ? err.message : String(err) };
  }

  // Pick up pending jobs that are due, plus 'processing' jobs whose claim is
  // stale: if the claim UPDATE commits but the response is lost, nothing else
  // ever re-reads that status and the job would be stranded forever. Five
  // minutes is far beyond any real processing time here. The is.null arm
  // covers rows claimed without a claimed_at stamp (strands from before
  // migration 00015's backfill, or claims by a not-yet-redeployed invocation
  // during a deploy; a lt. comparison is NULL-hostile and would skip them
  // forever). Those rows are NOT processed directly, only stamped, see below.
  const staleClaimCutoff = new Date(Date.now() - STALE_INVOCATION_MS).toISOString();
  // Las difusiones ya no pasan por esta cola (tienen su propia fase al final de la pasada).
  const dueFilter = `status.eq.pending,and(status.eq.processing,or(claimed_at.lt.${staleClaimCutoff},claimed_at.is.null))`;
  const { data: jobs, error } = await supabase
    .from("scheduled_jobs")
    .select("*")
    .or(dueFilter)
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(JOBS_BATCH);

  if (error || !jobs) {
    return { status: 500, body: { error: "Failed to fetch jobs", cases } };
  }

  let processed = 0;
  let failed = 0;
  const maxAttempts = 3;

  let skippedForTime = 0;
  for (const job of jobs) {
    // CONF-03: sin tiempo para empezar otro trabajo (puede tardar hasta 20 s) y
    // dejar su turno a las difusiones: lo que queda sigue pendiente para la siguiente pasada.
    if (Date.now() - startedAt > OTHER_JOBS_START_LIMIT_MS) {
      skippedForTime = jobs.length - jobs.indexOf(job);
      break;
    }
    // A 'processing' row without claimed_at cannot be aged: it is either a
    // pre-backfill strand or a live claim by an old-code invocation that
    // never stamped claimed_at (deploy window). Processing it now could
    // double-process against that live invocation (duplicate sends), so just
    // start the staleness clock; the lt arm reclaims it next run once it is
    // provably stale.
    if (job.status === "processing" && !job.claimed_at) {
      const { error: stampError } = await supabase
        .from("scheduled_jobs")
        .update({ claimed_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "processing")
        .is("claimed_at", null);
      if (stampError) {
        console.error(
          `Failed to stamp claimed_at on unaged job ${job.id}:`,
          stampError
        );
      }
      continue;
    }

    // A hung invocation (e.g. an httpRequest node on a never-responding
    // endpoint) never reaches the catch block, so the attempts cap there
    // cannot fire; without this guard the stale-claim reclaim would re-run
    // such a poison job forever, incrementing attempts unboundedly.
    if (job.attempts >= maxAttempts) {
      await failJobAndSettleSession({
        supabase,
        job,
        errorMessage: `Exceeded ${maxAttempts} attempts (stale claim reclaimed)`,
        onlyIfStuckOnDelayNode: true,
      });
      failed++;
      continue;
    }

    // Mark as processing; .select() returns the updated row so we can verify
    // the claim (overlapping cron runs would otherwise both process the job).
    // Matching attempts too makes this a CAS: once another run bumps attempts,
    // a stale snapshot can never re-claim the job, even after that run
    // requeues it as pending, so backoff and the attempt count are respected.
    const { data: claimed, error: claimError } = await supabase
      .from("scheduled_jobs")
      .update({
        status: "processing",
        attempts: job.attempts + 1,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status) // Optimistic lock (pending, or stale-claim reclaim)
      .eq("attempts", job.attempts)
      .select();

    if (claimError) {
      // Unknown outcome: the UPDATE may have committed with only the response
      // lost. Skip; if it did commit, the stale-claim reclaim above picks the
      // job up again once claimed_at ages past the cutoff.
      console.error(`Failed to claim job ${job.id}:`, claimError);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // Claim lost to another run

    try {
      await processJob(supabase, job);
      await supabase
        .from("scheduled_jobs")
        .update({ status: "completed" })
        .eq("id", job.id);
      processed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (err instanceof SessionRecheckError) {
        // Requeue past the recency window and undo the claim's attempts bump:
        // a recheck is not a failure, and letting rechecks exhaust attempts
        // would route a possibly-live session into the terminal cancel below.
        await supabase
          .from("scheduled_jobs")
          .update({
            status: "pending",
            run_at: new Date(Date.now() + STALE_INVOCATION_MS).toISOString(),
            attempts: job.attempts,
            last_error: errorMessage,
          })
          .eq("id", job.id);
      } else if (job.attempts + 1 >= maxAttempts || err instanceof SessionCancelError) {
        await failJobAndSettleSession({ supabase, job, errorMessage });
      } else {
        // Retry with backoff
        const backoffMs = Math.pow(2, job.attempts + 1) * 5000;
        const retryAt = new Date(Date.now() + backoffMs).toISOString();
        await supabase
          .from("scheduled_jobs")
          .update({
            status: "pending",
            run_at: retryAt,
            last_error: errorMessage,
          })
          .eq("id", job.id);
      }
      failed++;
    }
  }

  // 4. Difusiones: su propia porción, después de todo lo urgente.
  let broadcasts: Awaited<ReturnType<typeof runBroadcastSendPass>> | { error: string };
  try {
    broadcasts = await runBroadcastSendPass(supabase, { deadline: startedAt + BROADCAST_START_LIMIT_MS });
  } catch (err) {
    console.error("Broadcast send pass error:", err);
    broadcasts = { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    status: 200,
    body: { processed, failed, total: jobs.length, skippedForTime, inbound, orphans, cases, broadcasts },
  };
}

// Marks a job out of retries as failed. A failed resume_flow job would leave
// its session sitting active forever with no pending job, so settle it too
// (idempotent: non-load failures already cancelled it inside processJob).
// onlyIfStuckOnDelayNode (the attempts-exhausted reclaim path) additionally
// gates the cancel on the session NOT being healthily parked: a reclaimed
// job whose resume actually succeeded before its invocation died (or a
// duplicate from the old restart bug) leaves the session waiting at a later
// node, and cancelling it would kill the run mid-way. 'Moved past the delay
// node' alone is NOT that proof (a resume that died mid-traversal also moved
// past it), so the gate checks the recoverable-parking markers instead. The
// catch path must NOT gate: a SessionCancelError re-attempts a cancel for a
// session whose current_node_id may already have advanced.
async function failJobAndSettleSession({
  supabase,
  job,
  errorMessage,
  onlyIfStuckOnDelayNode = false,
}: {
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
  job: { id: string; type: string; payload: Json };
  errorMessage: string;
  onlyIfStuckOnDelayNode?: boolean;
}) {
  await supabase
    .from("scheduled_jobs")
    .update({ status: "failed", last_error: errorMessage })
    .eq("id", job.id);

  if (job.type !== "resume_flow") return;
  const payload = job.payload as { sessionId?: string; nodeId?: string } | null;
  const sessionId = payload?.sessionId;
  if (!sessionId) return;

  if (onlyIfStuckOnDelayNode) {
    const { data: session, error: sessionError } = await supabase
      .from("flow_sessions")
      .select("current_node_id, waiting_for_input, waiting_until, status, updated_at")
      .eq("id", sessionId)
      .single();
    if (sessionError || !session) {
      // Unknown state: do not cancel blind (the session may be healthily
      // waiting at a later node). Log so a possible strand stays visible.
      console.error(
        `Could not load session ${sessionId} to settle after job ${job.id} exhausted retries; session may be left active:`,
        sessionError
      );
      return;
    }
    if (session.status !== "active") return;
    if (payload?.nodeId && session.current_node_id !== payload.nodeId) {
      try {
        const parked = await isSessionParkedRecoverably({
          supabase,
          session: { id: sessionId, ...session },
          excludeJobId: job.id,
        });
        if (parked) return;
      } catch (err) {
        console.error(
          `Could not verify session ${sessionId} state after job ${job.id} exhausted retries; session may be left active:`,
          err
        );
        return;
      }
      // Written to within the stale window: a concurrent resume may be
      // mid-traversal (see SessionRecheckError). Do not cancel blind; the
      // job is already failed, so log the possible strand instead.
      if (wasSessionWrittenRecently(session.updated_at)) {
        console.error(
          `Session ${sessionId} was written recently after job ${job.id} exhausted retries; skipping cancel, session may be left active`
        );
        return;
      }
    }
  }

  const { error: settleError } = await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .eq("status", "active");
  if (settleError) {
    // The job is already 'failed' and never re-fetched, so this session stays
    // active with no pending job. Requeuing would not help: the retry hits the
    // stale-node guard in processJob and completes without cancelling. Log it
    // so the strand is visible.
    console.error(
      `Failed to settle session ${sessionId} after job ${job.id} exhausted retries; session left active:`,
      settleError
    );
  }
}

// A session that moved past a delay node is healthy only if the resume that
// moved it also parked it somewhere recoverable: waiting on input, stamped
// with a later delay's waiting_until (resumeSession clears it before
// traversing, so non-null means a later delay executed), or covered by
// another scheduled resume job (crash between the job insert and the
// waiting_until stamp in executeDelay). An active session with none of these
// was left by a resume invocation that died mid-traversal.
// Throws on a failed jobs read: unknown state must not be reported as
// unhealthy, or a transient read failure could cancel a live session.
async function isSessionParkedRecoverably({
  supabase,
  session,
  excludeJobId,
}: {
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
  session: { id: string; waiting_for_input: boolean; waiting_until: string | null };
  excludeJobId: string;
}): Promise<boolean> {
  if (session.waiting_for_input || session.waiting_until) return true;

  const { count, error } = await supabase
    .from("scheduled_jobs")
    .select("id", { count: "exact", head: true })
    .eq("type", "resume_flow")
    .in("status", ["pending", "processing"])
    .neq("id", excludeJobId)
    .contains("payload", { sessionId: session.id });
  if (error) {
    throw new Error(
      `could not check scheduled jobs for session ${session.id}: ${error.message}`
    );
  }
  return (count ?? 0) > 0;
}

async function processJob(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  job: { id: string; type: string; payload: Json }
) {
  switch (job.type) {
    case "resume_flow": {
      const payload = job.payload as {
        sessionId: string;
        flowId: string;
        channelId: string;
        contactId: string;
        conversationId: string;
        workspaceId: string;
        nodeId: string;
        lateConversationId?: string | null;
        lateAccountId?: string | null;
        variables?: Record<string, string> | null;
      };

      // Check if session is still active
      const { data: session, error: sessionError } = await supabase
        .from("flow_sessions")
        .select("*")
        .eq("id", payload.sessionId)
        .eq("status", "active")
        .single();

      if (!session) {
        // postgrest-js swallows transient failures into { data: null, error };
        // only PGRST116 (zero rows) means the session is genuinely
        // cancelled/completed. Anything else must throw so the job retries
        // with backoff instead of being marked completed.
        if (sessionError && sessionError.code !== "PGRST116") {
          throw new Error(
            `flow session ${payload.sessionId} could not be loaded: ${sessionError.message}`
          );
        }
        return;
      }

      // The session moved past the delay node. That alone does not mean the
      // resume succeeded (duplicate jobs left by the old restart bug): a
      // resume whose invocation died mid-traversal (maxDuration, hung fetch,
      // OOM) ALSO moved past it, after advancing current_node_id but before
      // parking the session. Disambiguate before treating the job as
      // satisfied; a stranded session would otherwise sit active forever
      // with no job and no log line.
      if (payload.nodeId && session.current_node_id !== payload.nodeId) {
        const parked = await isSessionParkedRecoverably({
          supabase,
          session,
          excludeJobId: job.id,
        });
        if (parked) return;
        // Not parked, but written to within the stale window: a concurrent
        // webhook resume may be mid-traversal (it clears waiting_for_input
        // before traversing, so the snapshot above shows no markers even for
        // a healthy live run). Cancelling now would kill it; look again once
        // the window has passed and the state is decidable.
        if (wasSessionWrittenRecently(session.updated_at)) {
          throw new SessionRecheckError(
            `session ${payload.sessionId} moved past delay node ${payload.nodeId} and is not parked, but was written recently; a concurrent resume may be mid-traversal`
          );
        }
        // This reclaimed job is the only evidence of the crash; route to the
        // failed + settle branch (which cancels the session) instead of
        // completing the job and discarding it.
        throw new SessionCancelError(
          `session ${payload.sessionId} moved past delay node ${payload.nodeId} to ${session.current_node_id} but is not waiting and has no scheduled job; a resume invocation died mid-traversal`
        );
      }

      // B-16: si un asesor tomó el chat mientras tanto, el bot no sigue enviando.
      if (await shouldCancelResumeForPausedBot(supabase, { variables: session.variables, conversationId: payload.conversationId })) {
        await supabase.from("flow_sessions").update({ status: "cancelled", waiting_for_input: false }).eq("id", session.id);
        console.warn(`[flows] la espera de la sesión ${session.id} se cancela: un asesor tomó el chat`);
        return;
      }

      // Resume from the node after the delay; resumeSession restores
      // variables from the session row and leaves {{message}} untouched
      // because incomingMessage is empty.
      try {
        await resumeSession(supabase, session, {
          triggerId: "",
          flowId: session.flow_id,
          channelId: payload.channelId,
          contactId: payload.contactId,
          conversationId: payload.conversationId,
          workspaceId: payload.workspaceId,
          lateConversationId: payload.lateConversationId || undefined,
          lateAccountId: payload.lateAccountId || undefined,
          variables: payload.variables || undefined,
          incomingMessage: {},
        });
      } catch (err) {
        // A FlowLoadError is thrown before resumeSession advances
        // current_node_id, so the retry cannot hit the stale-node guard
        // above; leave the session active and let the cron backoff retry
        // recover from the transient failure.
        if (err instanceof FlowLoadError) throw err;

        // Any other throw may have advanced current_node_id past the delay
        // node; the retry would then hit the stale-node guard above and
        // complete, stranding the session as active with no pending job.
        // Cancel it so the failure is explicit.
        const { error: cancelError } = await supabase
          .from("flow_sessions")
          .update({ status: "cancelled" })
          .eq("id", payload.sessionId);
        if (cancelError) {
          // postgrest swallows network failures into { error }, so an
          // unchecked cancel can silently no-op; see SessionCancelError.
          throw new SessionCancelError(
            `resume of session ${payload.sessionId} failed (${
              err instanceof Error ? err.message : String(err)
            }) and the session cancel also failed: ${cancelError.message}`
          );
        }
        console.error(
          `Failed to resume flow session ${payload.sessionId} (flow ${session.flow_id}), session cancelled:`,
          err
        );
        throw err;
      }
      break;
    }

    case "send_broadcast": {
      // Versión anterior: había un trabajo por destinatario. Ahora los envíos los toma
      // runBroadcastSendPass directo de broadcast_recipients; este trabajo ya no hace nada
      // (si quedara alguno, solo se cierra). Nadie recibe el mensaje dos veces: el
      // destinatario sigue pendiente y lo envía la fase de difusiones.
      break;
    }

    default:
      console.warn(`Unknown job type: ${job.type}`);
  }
}
