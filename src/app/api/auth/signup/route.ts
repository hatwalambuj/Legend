import { signUpSchema, type AuthResponse } from '@/lib/contracts';
import { authRateLimiter, container } from '@/server/container';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { env } from '@/server/env';
import { clientIp, enforce, limitFor } from '@/server/rate-limit';

/** POST /api/auth/signup → 201 AuthResponse + session cookie (API_CONTRACT §5.18). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const limit = limitFor('signUp', env().mode.data === 'local');
  enforce(
    authRateLimiter().consumeSync(`signup:${clientIp(req.headers)}`, limit.max, limit.windowSec),
    'Too many sign-ups from here. Try again shortly.',
  );
  const input = await parseBody(req, signUpSchema);
  const session = await container().auth.signUp({
    email: input.email,
    password: input.password,
    handle: input.handle,
    displayName: input.displayName ?? input.handle,
  });
  const body: AuthResponse = { session };
  return json(body, { status: 201 });
});
