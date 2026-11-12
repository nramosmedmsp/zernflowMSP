import { getWorkspace } from "@/lib/workspace";
import { AnalyticsView } from "./analytics-view";
import { limaDayKeys } from "./day-buckets";
import { buildDailySeries, buildFlowPerformance } from "./aggregate";

export default async function AnalyticsPage() {
  const { workspace, supabase } = await getWorkspace();

  const nowDate = new Date();
  const thirtyDaysAgo = new Date(
    nowDate.getTime() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = nowDate.toISOString();

  // Los conteos pesados los hace la base (funciones de la 00045, con los permisos de
  // la persona): ningún número depende de cuántas filas devuelva la API (tope de 1 000).
  const [flowsRes, contactsRes, sentRes, failedRes, statsRes, flowsListRes, dailyRes] = await Promise.all([
    supabase.from("flows").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("event_type", "message_sent")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now),
    supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("event_type", "message_failed")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now),
    supabase.rpc("analytics_flow_stats", { p_workspace: workspace.id, p_from: thirtyDaysAgo, p_to: now }),
    supabase.from("flows").select("id, name").eq("workspace_id", workspace.id),
    supabase.rpc("analytics_daily", { p_workspace: workspace.id, p_from: thirtyDaysAgo, p_to: now }),
  ]);
  // Un error de la base no puede verse como "cero": que lo recoja la pantalla de error.
  if (statsRes.error || dailyRes.error) {
    throw new Error(`No se pudo calcular la analítica: ${(statsRes.error ?? dailyRes.error)?.message}`);
  }

  const flowNames = new Map((flowsListRes.data ?? []).map((f) => [f.id, f.name]));
  const flowPerformance = buildFlowPerformance(statsRes.data ?? [], flowNames);
  const { contactGrowth, messageVolume } = buildDailySeries(dailyRes.data ?? [], limaDayKeys(thirtyDaysAgo, now));

  return (
    <AnalyticsView
      workspaceId={workspace.id}
      initialData={{
        stats: {
          totalFlows: flowsRes.count ?? 0,
          totalContacts: contactsRes.count ?? 0,
          messagesSent: sentRes.count ?? 0,
          messagesFailed: failedRes.count ?? 0,
        },
        flowPerformance,
        contactGrowth,
        messageVolume,
      }}
    />
  );
}
