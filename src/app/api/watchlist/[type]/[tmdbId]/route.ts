import { z } from 'zod';
import { mediaTypeSchema, tmdbIdSchema, type WatchlistResponse } from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import type { MediaType } from '@/lib/types';
import { container } from '@/server/container';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { setWatchlisted } from '@/server/services/reviews';
import { requireSession } from '@/server/session';

type Ctx = { params: Promise<{ type: string; tmdbId: string }> };

async function titleRef(ctx: Ctx): Promise<{ mediaType: MediaType; tmdbId: number }> {
  const p = await ctx.params;
  const type = mediaTypeSchema.safeParse(p.type);
  const id = tmdbIdSchema.safeParse(p.tmdbId);
  if (!type.success || !id.success) throw new AppError('not_found', "This ticket doesn't exist.");
  return { mediaType: type.data, tmdbId: id.data };
}

/** PUT /api/watchlist/{type}/{id} with body {} → { watchlisted: true }. Idempotent. */
export const PUT = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const ref = await titleRef(ctx);
  await parseBody(req, z.object({}));
  const { watchlisted } = await setWatchlisted(c, session, ref.mediaType, ref.tmdbId, true);
  const body: WatchlistResponse = { watchlisted };
  return json(body);
});

/** DELETE /api/watchlist/{type}/{id} → { watchlisted: false }. Idempotent. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const ref = await titleRef(ctx);
  const { watchlisted } = await setWatchlisted(c, session, ref.mediaType, ref.tmdbId, false);
  const body: WatchlistResponse = { watchlisted };
  return json(body);
});
