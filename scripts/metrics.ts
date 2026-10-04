/**
 * Weekly product metrics (ADR-013 C-09): prints the last 8 ISO weeks of `public.metrics_weekly`,
 * then the last 7 days of `client_error` / `server_error` counters from `public.events` (AR-C2).
 * Service role only (the view is revoked from anon/authenticated). Run: `npx tsx scripts/metrics.ts`.
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. OWNER: Backend.
 */
import { createClient } from '@supabase/supabase-js';
import { parseEnv } from '../src/server/env';
import {
  ERROR_EVENT_NAMES,
  formatErrorCounts,
  formatMetrics,
  windowStart,
  type ErrorCountRow,
  type MetricsWeek,
} from './lib/metrics';

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
  // AR-C2: error counters (Vercel Hobby keeps runtime logs ~1 h; these keep 400 days).
  const errors = await db
    .from('events')
    .select('day,name,dim,count')
    .in('name', [...ERROR_EVENT_NAMES])
    .gte('day', windowStart(7))
    .limit(2000);
  if (errors.error) throw new Error(`events: ${errors.error.message}`);
  console.log(`\n${formatErrorCounts((errors.data ?? []) as ErrorCountRow[])}`);
}

main().catch((e: unknown) => {
  console.error('[metrics] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
