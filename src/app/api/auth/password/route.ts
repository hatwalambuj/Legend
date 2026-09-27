import { setPasswordSchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { env } from '@/server/env';
import { assertSameOrigin, noContent, parseBody, route } from '@/server/http';
import { enforce, limitFor } from '@/server/rate-limit';
import { requireSession } from '@/server/session';

/**
 * PUT /api/auth/password → 204 (API_CONTRACT §5.18 v1.4, ADR-010 ID-2). Needs a sign-in at most 10 min
 * old (else 401 reauth_required); 5 per 10 min per user. Other sessions stay valid.
 */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const input = await parseBody(req, setPasswordSchema);
  const limit = limitFor('setPassword', env().mode.data === 'local', env().trustedProxy);
  enforce(
    await c.rateLimiter.consume(`password:${session.user.id}`, limit.max, limit.windowSec),
    'Too many password changes. Try again in a few minutes.',
  );
  await c.auth.updatePassword(input.password);
  return noContent();
});
