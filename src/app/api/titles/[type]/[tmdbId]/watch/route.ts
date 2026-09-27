import {
  mediaTypeSchema,
  tmdbIdSchema,
  watchQuerySchema,
  type TitleWatchResponse,
} from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { titleWatchFor } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';
import { regionInfo, watchRegionConfig } from '@/server/region';

type Ctx = { params: Promise<{ type: string; tmdbId: string }> };

/**
 * GET /api/titles/{movie|tv}/{tmdbId}/watch?region=GB (API_CONTRACT §5.21, ADR-012 §6.2).
 * Public and CDN-cached per URL: `region` is required and is the ONLY region input. This handler reads
 * no cookie, no Accept-Language and no geo header, and never sets a cookie. An unsupported region
 * answers with the default region and `fallback: true`. Unknown type or id → 404.
 */
export const GET = route<Ctx>(async (req, ctx) => {
  const p = await ctx.params;
  const type = mediaTypeSchema.safeParse(p.type);
  const id = tmdbIdSchema.safeParse(p.tmdbId);
  if (!type.success || !id.success) throw new AppError('not_found', 'Unknown title.');
  const { region } = parseQuery(req, watchQuerySchema);
  const info = regionInfo(region, 'query', watchRegionConfig());
  const watch = await titleWatchFor(type.data, id.data, info);
  if (watch === undefined) throw new AppError('not_found', 'Unknown title.');
  const body: TitleWatchResponse = { watch };
  return json(body, { cache: CACHE.watch });
});
