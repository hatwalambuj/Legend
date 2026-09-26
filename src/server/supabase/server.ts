/**
 * Supabase clients (live mode only). OWNER: Backend.
 * - `supabaseForRequest()` : user-scoped client bound to request cookies → RLS applies. Use for ALL
 *   user reads/writes. Never use the service role in request handling except /api/revalidate + export.
 * - `supabasePublic()`     : anon client that never touches cookies — for public reads (profiles,
 *   diaries, reviews) so public pages never depend on the session (API_CONTRACT §1 rule 1).
 * - `supabaseCatalog()`    : like `supabasePublic()`, but GET requests go through the Next data cache
 *   for 1 h with the `catalog` tag (revalidated by the nightly sync), per API_CONTRACT §4.
 * - `supabaseAdmin()`      : service-role client. Server-only (L2 detail cache writes, jobs).
 */
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { AppError } from '@/lib/errors';
import { isSecureRequest } from '@/server/auth/cookies';
import { env } from '@/server/env';

function config() {
  const cfg = env().supabase;
  if (!cfg) throw new AppError('internal', 'Supabase is not configured');
  return cfg;
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * ADR-005: session cookies are httpOnly + SameSite=Lax (+ Secure over https). @supabase/ssr defaults to
 * `httpOnly: false` (for browser clients); we never read auth cookies in the browser, so lock them down.
 */
function authCookieOptions(secure: boolean) {
  return { path: '/', sameSite: 'lax' as const, httpOnly: true, secure };
}

export async function supabaseForRequest(): Promise<SupabaseClient> {
  const cfg = config();
  const jar = await cookies();
  const secure = isSecureRequest(await headers(), env().siteUrl);
  return createServerClient(cfg.url, cfg.anonKey, {
    cookieOptions: authCookieOptions(secure),
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

let publicClient: SupabaseClient | null = null;
let catalogClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

export function supabasePublic(): SupabaseClient {
  const cfg = config();
  publicClient ??= createClient(cfg.url, cfg.anonKey, { auth: NO_SESSION });
  return publicClient;
}

/** fetch that lets idempotent GETs use the Next data cache (tag `catalog`, 1 h). */
export const catalogFetch: typeof fetch = (input, init) =>
  (init?.method ?? 'GET').toUpperCase() === 'GET'
    ? fetch(input, {
        ...init,
        next: { revalidate: 3600, tags: ['catalog'] },
      } as RequestInit)
    : fetch(input, init);

export function supabaseCatalog(): SupabaseClient {
  const cfg = config();
  catalogClient ??= createClient(cfg.url, cfg.anonKey, {
    auth: NO_SESSION,
    global: { fetch: catalogFetch },
  });
  return catalogClient;
}

export function supabaseAdmin(): SupabaseClient {
  const cfg = config();
  if (!cfg.serviceRoleKey)
    throw new AppError('internal', 'SUPABASE_SERVICE_ROLE_KEY is not configured');
  adminClient ??= createClient(cfg.url, cfg.serviceRoleKey, { auth: NO_SESSION });
  return adminClient;
}
