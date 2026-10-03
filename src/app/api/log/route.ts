import { clientLogSchema } from '@/lib/contracts';
import { authRateLimiter } from '@/server/container';
import { env } from '@/server/env';
import { assertSameOrigin, noContent, parseBodyLimited, route } from '@/server/http';
import { log, stripQuery, uaFamily } from '@/server/log';
import { clientIp, enforce, ipKey, limitFor, LIMITS } from '@/server/rate-limit';

/** ≤ 4 KB (ADR-013 C-13). */
const MAX_BYTES = 4 * 1024;

/**
 * POST /api/log (API_CONTRACT §5.25): one redacted `client_error` JSON line in our own server logs.
 * No third party, no IP (the limiter key is a salted in-memory hash), the UA family only, and the path
 * without query or hash. Limits: 10/min per IP and 300/min per process.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const e = env();
  const l = limitFor('clientLog', e.mode.data === 'local', e.trustedProxy);
  const limiter = authRateLimiter();
  enforce(
    limiter.consumeSync(`log:${ipKey(clientIp(req.headers, e.trustedProxy))}`, l.max, l.windowSec),
    'Too many reports.',
  );
  enforce(
    limiter.consumeSync(
      'log:process',
      LIMITS.clientLogProcess.max,
      LIMITS.clientLogProcess.windowSec,
    ),
    'Too many reports.',
  );
  const body = await parseBodyLimited(req, clientLogSchema, MAX_BYTES);
  log.error('client_error', {
    kind: body.kind,
    message: body.message,
    ...(body.digest ? { digest: body.digest } : {}),
    ...(body.stack ? { stack: body.stack } : {}),
    path: stripQuery(body.path).slice(0, 200),
    uaFamily: uaFamily(req.headers.get('user-agent')),
  });
  return noContent();
});
