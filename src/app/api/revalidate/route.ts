import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { revalidateSchema } from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { env } from '@/server/env';
import { json, parseBody, route } from '@/server/http';

/** Called by the nightly sync job: POST { tags: ['catalog'] } with header x-revalidate-secret. */
export const POST = route(async (req) => {
  const secret = env().revalidateSecret;
  const given = req.headers.get('x-revalidate-secret') ?? '';
  if (
    !secret ||
    given.length !== secret.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  ) {
    throw new AppError('forbidden', 'Bad revalidate secret.');
  }
  const { tags } = await parseBody(req, revalidateSchema);
  for (const t of tags) revalidateTag(t, 'max');
  return json({ revalidated: tags });
});
