import { signInSchema, type AuthResponse } from '@/lib/contracts';
import { authRateLimiter, container } from '@/server/container';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { env } from '@/server/env';
import { clientIp, enforce, limitFor } from '@/server/rate-limit';

/** POST /api/auth/signin → 200 AuthResponse; any failure is the generic invalid_credentials. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const e = env();
  const limit = limitFor('signIn', e.mode.data === 'local', e.trustedProxy);
  enforce(
    authRateLimiter().consumeSync(
      `signin:${clientIp(req.headers, e.trustedProxy)}`,
      limit.max,
      limit.windowSec,
    ),
    'Too many sign-in attempts. Try again shortly.',
  );
  const input = await parseBody(req, signInSchema);
  const body: AuthResponse = { session: await container().auth.signIn(input) };
  return json(body);
});
