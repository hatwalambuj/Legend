import { safeNext } from '@/lib/routes';
import { container } from '@/server/container';
import { redirectRelative, route } from '@/server/http';

/**
 * GET /auth/callback?code=…|demo_token=…&next=… (API_CONTRACT §5.18).
 * Live: Supabase PKCE / magic-link code exchange. Demo: the signed token from the dev magic link.
 * Success → 302 safeNext(next) with the session cookie; anything else → 302 /signin?error=callback.
 */
export const GET = route(async (req) => {
  const p = req.nextUrl.searchParams;
  const next = safeNext(p.get('next'));
  let ok = false;
  try {
    ok = await container().auth.completeCallback({
      code: p.get('code'),
      demoToken: p.get('demo_token'),
    });
  } catch (e) {
    console.error('[auth/callback] exchange failed', e);
  }
  const target = ok ? next : `/signin?error=callback&next=${encodeURIComponent(next)}`;
  // safeNext() guarantees a same-origin relative path, so a relative Location is safe.
  return redirectRelative(target);
});
