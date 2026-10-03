import { signUpSchema, type AuthResponse } from '@/lib/contracts';
import { authRateLimiter, container } from '@/server/container';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { env } from '@/server/env';
import { recordEvent } from '@/server/events';
import { clientIp, enforce, limitFor } from '@/server/rate-limit';

/**
 * POST /api/auth/signup → 201 AuthResponse + session cookie (API_CONTRACT §5.18). v1.4 (ADR-010 ID-1):
 * when Supabase "Confirm email" is ON there is no session yet → 202 { session: null, confirmEmail: true }
 * and no cookie. Demo mode always signs in.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const e = env();
  const limit = limitFor('signUp', e.mode.data === 'local', e.trustedProxy);
  enforce(
    authRateLimiter().consumeSync(
      `signup:${clientIp(req.headers, e.trustedProxy)}`,
      limit.max,
      limit.windowSec,
    ),
    'Too many sign-ups from here. Try again shortly.',
  );
  const input = await parseBody(req, signUpSchema);
  const session = await container().auth.signUp({
    email: input.email,
    password: input.password,
    handle: input.handle,
    displayName: input.displayName ?? input.handle,
  });
  const body: AuthResponse = session ? { session } : { session: null, confirmEmail: true };
  // ADR-013 C-09: anonymous; `ref` only picks the dim (no id, email or handle is recorded).
  recordEvent('signup_completed', input.ref === 'share' ? 'share' : '');
  return json(body, { status: session ? 201 : 202 });
});
