import { magicLinkSchema, type MagicLinkResponse } from '@/lib/contracts';
import { safeNext } from '@/lib/routes';
import { authRateLimiter, container } from '@/server/container';
import { env } from '@/server/env';
import { assertSameOrigin, json, parseBody, requestOrigin, route } from '@/server/http';
import { clientIp, emailKey, enforce, limitFor } from '@/server/rate-limit';

/**
 * POST /api/auth/magic-link → 202 { sent: true, devLink? }. Never reveals whether the email exists.
 * Live: Supabase emails a link to {NEXT_PUBLIC_SITE_URL}/auth/callback (must be an allowed redirect URL).
 * Demo: the link is returned as devLink, pointing at this server's own origin.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseBody(req, magicLinkSchema);
  const e = env();
  const demo = e.mode.data === 'local';
  const ipLimit = limitFor('magicLink', demo, e.trustedProxy);
  const mailLimit = limitFor('magicLinkEmail', demo, e.trustedProxy);
  const limiter = authRateLimiter();
  const msg = 'Too many links requested. Try again in a few minutes.';
  enforce(
    limiter.consumeSync(
      `magic-ip:${clientIp(req.headers, e.trustedProxy)}`,
      ipLimit.max * 4,
      ipLimit.windowSec,
    ),
    msg,
  );
  // ID-5: 5 per inbox per hour from any number of IPs; keyed by a SHA-256, never the raw email.
  enforce(
    limiter.consumeSync(`magic-email:${emailKey(input.email)}`, mailLimit.max, mailLimit.windowSec),
    msg,
  );
  const origin = e.mode.data === 'supabase' ? e.siteUrl : requestOrigin(req);
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', safeNext(input.next));
  const { devLink } = await container().auth.sendMagicLink({
    email: input.email,
    redirectTo: callback.toString(),
  });
  const body: MagicLinkResponse = {
    sent: true,
    ...(e.mode.data === 'local' && devLink ? { devLink } : {}),
  };
  return json(body, { status: 202 });
});
