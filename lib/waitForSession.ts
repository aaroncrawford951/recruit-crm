import type { Session, SupabaseClient } from "@supabase/supabase-js";

/**
 * Waits briefly for Supabase to restore a session on the client.
 * Returns the Session if found, otherwise null.
 */
export async function waitForSession(
  supabase: SupabaseClient,
  timeoutMs: number = 1500,
  pollMs: number = 150
): Promise<Session | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    if (data.session) return data.session;

    await new Promise((r) => setTimeout(r, pollMs));
  }

  return null;
}
