/**
 * Next 16 `proxy` (formerly middleware). OWNER: Backend.
 * Live mode: refresh the Supabase session cookie before RSC renders (per @supabase/ssr guidance), but
 * only for requests that carry a Supabase auth cookie — anonymous traffic never costs an auth call.
 * A response that refreshes cookies is marked `private, no-store` (never Set-Cookie on a public response).
 * Demo mode: no-op. Never do data fetching or authorization decisions here — do them in the DAL.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSecureRequest } from '@/server/auth/cookies';
import { env } from '@/server/env';
import { shareImageKind, shareImageRedirect } from '@/server/share-cache';

export function hasSupabaseAuthCookie(req: Pick<NextRequest, 'cookies'>): boolean {
  return req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
}

export async function proxy(request: NextRequest) {
  // Share/OG images (R1): one canonical URL per content version, so query strings can't force renders.
  // They read no cookie, so they also skip the session refresh (never Set-Cookie on a public image).
  if (shareImageKind(request.nextUrl.pathname)) {
    const to = shareImageRedirect(new URL(request.url));
    if (!to) return NextResponse.next();
    const res = NextResponse.redirect(to, 308);
    res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res;
  }
  const e = env();
  if (e.mode.data !== 'supabase' || !e.supabase || !hasSupabaseAuthCookie(request))
    return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(e.supabase.url, e.supabase.anonKey, {
    // Same flags as supabaseForRequest(): httpOnly + SameSite=Lax (+ Secure over https), ADR-005.
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: isSecureRequest(request.headers, e.siteUrl),
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        response.headers.set('Cache-Control', 'private, no-store');
      },
    },
  });
  try {
    // ADR-013 C-05: verified claims (local JWKS with asymmetric keys); refreshes cookies via setAll.
    await supabase.auth.getClaims();
  } catch (err) {
    console.warn('[proxy] session refresh failed', err instanceof Error ? err.name : 'error');
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2)$).*)',
  ],
};
