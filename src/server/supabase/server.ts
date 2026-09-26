/**
 * Supabase clients (live mode only). OWNER: Backend.
 * - `supabaseForRequest()` : user-scoped client bound to request cookies → RLS applies. Use for ALL
 *   user reads/writes. Never use the service role in request handling except /api/revalidate + export.
 * - `supabaseAdmin()`      : service-role client. Server-only (sync job, admin tasks).
 */
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AppError } from '@/lib/errors';
import { env } from '@/server/env';

export async function supabaseForRequest(): Promise<SupabaseClient> {
  const cfg = env().supabase;
  if (!cfg) throw new AppError('internal', 'Supabase is not configured');
  const jar = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. proxy.ts refreshes sessions.
        }
      },
    },
  });
}

export function supabaseAdmin(): SupabaseClient {
  const cfg = env().supabase;
  if (!cfg?.serviceRoleKey)
    throw new AppError('internal', 'SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
