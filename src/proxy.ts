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

export function hasSupabaseAuthCookie(req: Pick<NextRequest, 'cookies'>): boolean {
  return req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
}

export async function proxy(request: NextRequest) {
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
    await supabase.auth.getUser();
  } catch (err) {
    console.warn('[proxy] session refresh failed', err);
  }
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2)$).*)',
  ],
};
