import {
  mediaTypeSchema,
  titleReviewsQuerySchema,
  tmdbIdSchema,
  type TitleReviewsResponse,
} from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { toTitleKey } from '@/lib/keys';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';

type Ctx = { params: Promise<{ type: string; tmdbId: string }> };

export const GET = route<Ctx>(async (req, ctx) => {
  const p = await ctx.params;
  const type = mediaTypeSchema.safeParse(p.type);
  const id = tmdbIdSchema.safeParse(p.tmdbId);
  if (!type.success || !id.success) throw new AppError('not_found', 'Unknown title.');
  const q = parseQuery(req, titleReviewsQuerySchema);
  const body: TitleReviewsResponse = await dal.listTitleReviews(toTitleKey(type.data, id.data), q);
  return json(body, { cache: CACHE.reviews });
});
