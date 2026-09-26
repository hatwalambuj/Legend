import { NextResponse } from 'next/server';
import { safeNext } from '@/lib/routes';
import { route } from '@/server/http';

/**
 * Supabase PKCE / magic-link callback (live mode). OWNER: Backend.
 * TODO(Backend): supabase.auth.exchangeCodeForSession(code), then redirect to safeNext(next).
 * Demo mode: the dev magic link points here with ?demo_token=… (Backend decides the format).
 */
export const GET = route(async (req) => {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  return NextResponse.redirect(new URL(next, req.nextUrl.origin));
});
