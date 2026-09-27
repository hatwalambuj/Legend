import { NextResponse, type NextRequest } from 'next/server';
import { authRateLimiter, container } from '@/server/container';
import { env } from '@/server/env';
import { checkHealth } from '@/server/health';
import { route } from '@/server/http';
import { clientIp, enforce, limitFor } from '@/server/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET/HEAD /api/health (API_CONTRACT §5.1 v1.4, ADR-011 §3): uncached probe, 3 s timeout, `?strict=1`
 * turns `degraded` into 503, `Cache-Control: no-store`, 60/min per IP. Never reads or sets cookies.
 */
async function health(req: NextRequest, withBody: boolean): Promise<Response> {
  const e = env();
  const limit = limitFor('health', e.mode.data === 'local', e.trustedProxy);
  enforce(
    authRateLimiter().consumeSync(
      `health:${clientIp(req.headers, e.trustedProxy)}`,
      limit.max,
      limit.windowSec,
    ),
    'Too many health checks. Try again in a minute.',
  );
  const catalog = container().catalog;
  const { httpStatus, body } = await checkHealth({
    mode: e.mode,
    probe: (opts) => catalog.probe(opts),
    maxSyncAgeHours: e.health.maxSyncAgeHours,
    strict: req.nextUrl.searchParams.get('strict') === '1',
  });
  const headers = { 'Cache-Control': 'no-store' };
  return withBody
    ? NextResponse.json(body, { status: httpStatus, headers })
    : new NextResponse(null, { status: httpStatus, headers });
}

export const GET = route((req) => health(req, true));
export const HEAD = route((req) => health(req, false));
