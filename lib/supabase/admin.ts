import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

/**
 * The sole database client for privileged server operations. Never import this
 * module from a Client Component or expose its key through NEXT_PUBLIC_.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
