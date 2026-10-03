import { trackEventsSchema } from '@/lib/contracts';
import { authRateLimiter } from '@/server/container';
import { env } from '@/server/env';
import { analyticsEnabled, recordEvents } from '@/server/events';
import { assertSameOrigin, noContent, parseBodyLimited, route } from '@/server/http';
import { clientIp, enforce, ipKey, limitFor } from '@/server/rate-limit';

/** ≤ 8 KB (ADR-013 C-09). */
const MAX_BYTES = 8 * 1024;

/**
 * POST /api/events (API_CONTRACT §5.24): anonymous client counters. Never reads the session or a cookie;
 * stores no IP, user id, UA or URL. The per-IP limit uses a salted in-memory key that is never stored or
 * logged. `Sec-GPC: 1` or `ANALYTICS_ENABLED=false` → 204 with nothing recorded.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const e = env();
  const l = limitFor('events', e.mode.data === 'local', e.trustedProxy);
  enforce(
    authRateLimiter().consumeSync(
      `events:${ipKey(clientIp(req.headers, e.trustedProxy))}`,
      l.max,
      l.windowSec,
    ),
    'Too many events.',
  );
  const body = await parseBodyLimited(req, trackEventsSchema, MAX_BYTES);
  if (req.headers.get('sec-gpc') === '1' || !analyticsEnabled()) return noContent();
  recordEvents(body.events);
  return noContent();
});
