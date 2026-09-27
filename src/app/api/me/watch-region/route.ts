import { setWatchRegionSchema, type SetWatchRegionResponse } from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { requestCookieJar } from '@/server/auth/cookies';
import { authRateLimiter, container } from '@/server/container';
import { env } from '@/server/env';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { clientIp, enforce, limitFor } from '@/server/rate-limit';
import { writeRegionCookie } from '@/server/region';

/**
 * PUT /api/me/watch-region { region: 'GB' | null } (API_CONTRACT §5.22, ADR-012 §7). 🔒-soft:
 * signed out → cookie only; signed in → also upserts the owner-only `user_settings` row (RLS), then the
 * cookie. null = automatic (clears both). Same-origin + JSON; 30/min per IP; `private, no-store`.
 */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const e = env();
  const limit = limitFor('watchRegion', e.mode.data === 'local', e.trustedProxy);
  enforce(
    authRateLimiter().consumeSync(
      `watch_region:${clientIp(req.headers, e.trustedProxy)}`,
      limit.max,
      limit.windowSec,
    ),
    'Too many changes. Try again shortly.',
  );
  const { region } = await parseBody(req, setWatchRegionSchema);
  if (region !== null && !e.watch.regions.includes(region))
    throw new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { region: 'That region is not supported yet.' },
    });
  const c = container();
  const session = await c.auth.getSession();
  if (session) await c.settings.setWatchRegion(session.user.id, region);
  writeRegionCookie(await requestCookieJar(), region);
  const body: SetWatchRegionResponse = { region };
  return json(body);
});
