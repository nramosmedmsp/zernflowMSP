import { getWorkspace } from "@/lib/workspace";
import { AnalyticsView } from "./analytics-view";
import { limaDayKey, limaDayKeys } from "./day-buckets";

export default async function AnalyticsPage() {
  const { workspace, supabase } = await getWorkspace();

  const nowDate = new Date();
  const thirtyDaysAgo = new Date(
    nowDate.getTime() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = nowDate.toISOString();

  // Obtener en el servidor, en paralelo, todos los datos iniciales de analítica
  const [
    flowsRes,
    contactsRes,
    sentRes,
    failedRes,
    startsRes,
    completionsRes,
    flowsListRes,
    contactEvents,
    msgEvents,
  ] = await Promise.all([
    supabase
      .from("flows")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
    supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
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
    supabase
      .from("analytics_events")
      .select("flow_id")
      .eq("workspace_id", workspace.id)
      .eq("event_type", "flow_started")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .not("flow_id", "is", null),
    supabase
      .from("analytics_events")
      .select("flow_id")
      .eq("workspace_id", workspace.id)
      .eq("event_type", "flow_completed")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .not("flow_id", "is", null),
    supabase
      .from("flows")
      .select("id, name")
      .eq("workspace_id", workspace.id),
    supabase
      .from("contacts")
      .select("created_at")
      .eq("workspace_id", workspace.id)
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .order("created_at"),
    supabase
      .from("analytics_events")
      .select("event_type, created_at")
      .eq("workspace_id", workspace.id)
      .in("event_type", ["message_sent", "message_failed"])
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .order("created_at"),
  ]);

  // Armar el rendimiento de los flujos
  const flowNames = new Map(
    (flowsListRes.data ?? []).map((f) => [f.id, f.name])
  );
  const startCounts = new Map<string, number>();
  (startsRes.data ?? []).forEach((e) => {
    if (e.flow_id) startCounts.set(e.flow_id, (startCounts.get(e.flow_id) ?? 0) + 1);
  });
  const completionCounts = new Map<string, number>();
  (completionsRes.data ?? []).forEach((e) => {
    if (e.flow_id) completionCounts.set(e.flow_id, (completionCounts.get(e.flow_id) ?? 0) + 1);
  });
  const allFlowIds = new Set([...startCounts.keys(), ...completionCounts.keys()]);
  const flowPerformance = Array.from(allFlowIds)
    .map((fid) => {
      const starts = startCounts.get(fid) ?? 0;
      const completions = completionCounts.get(fid) ?? 0;
      const dropOffRate = starts > 0 ? Math.round(((starts - completions) / starts) * 100) : 0;
      return { id: fid, name: flowNames.get(fid) ?? "Flujo desconocido", starts, completions, dropOffRate };
    })
    .sort((a, b) => b.starts - a.starts)
    .slice(0, 10);

  // Armar el crecimiento diario de contactos
  const growthByDay = new Map<string, number>();
  (contactEvents.data ?? []).forEach((e) => {
    const day = limaDayKey(e.created_at);
    growthByDay.set(day, (growthByDay.get(day) ?? 0) + 1);
  });
  const dayKeys = limaDayKeys(thirtyDaysAgo, now);
  const contactGrowth: { date: string; count: number }[] = dayKeys.map((dayStr) => ({
    date: dayStr,
    count: growthByDay.get(dayStr) ?? 0,
  }));

  // Armar el volumen diario de mensajes
  const sentByDay = new Map<string, number>();
  const failedByDay = new Map<string, number>();
  (msgEvents.data ?? []).forEach((e) => {
    const day = limaDayKey(e.created_at);
    if (e.event_type === "message_sent") {
      sentByDay.set(day, (sentByDay.get(day) ?? 0) + 1);
    } else {
      failedByDay.set(day, (failedByDay.get(day) ?? 0) + 1);
    }
  });
  const messageVolume: { date: string; sent: number; failed: number }[] = dayKeys.map(
    (dayStr) => ({
      date: dayStr,
      sent: sentByDay.get(dayStr) ?? 0,
      failed: failedByDay.get(dayStr) ?? 0,
    }),
  );

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
