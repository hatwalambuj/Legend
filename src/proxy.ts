/**
 * Next 16 `proxy` (formerly middleware). OWNER: Backend.
 * Live mode: refresh the Supabase session cookie on every request (per @supabase/ssr guidance).
 * Demo mode: no-op. Never do data fetching or authorization decisions here — do them in the DAL.
 */
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(_request: NextRequest) {
  // TODO(Backend, live mode): createServerClient(...) with request/response cookie adapters and
  // `await supabase.auth.getUser()` so expired access tokens are refreshed before RSC renders.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2)$).*)',
  ],
};
