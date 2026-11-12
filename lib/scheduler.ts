import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

/**
 * Schedule a job to run at a specific time.
 */
export async function scheduleJob(
  supabase: SupabaseClient<Database>,
  type: string,
  payload: Record<string, unknown>,
  runAt: Date
) {
  const { data, error } = await supabase
    .from("scheduled_jobs")
    .insert({
      type,
      payload: payload as unknown as Json,
      run_at: runAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
