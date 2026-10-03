/**
 * Weekly product metrics (ADR-013 C-09): prints the last 8 ISO weeks of `public.metrics_weekly`.
 * Service role only (the view is revoked from anon/authenticated). Run: `npx tsx scripts/metrics.ts`.
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. OWNER: Backend.
 */
import { createClient } from '@supabase/supabase-js';
import { parseEnv } from '../src/server/env';
import { formatMetrics, type MetricsWeek } from './lib/metrics';

async function main() {
  const env = parseEnv();
  if (!env.supabase?.serviceRoleKey) {
    console.log(
      '[metrics] Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (live mode).',
    );
    return;
  }
  const db = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.from('metrics_weekly').select('*').limit(8);
  if (error) throw new Error(`metrics_weekly: ${error.message}`);
  console.log(formatMetrics((data ?? []) as MetricsWeek[]));
}

main().catch((e: unknown) => {
  console.error('[metrics] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
