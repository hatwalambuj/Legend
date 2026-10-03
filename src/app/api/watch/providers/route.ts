import { watchProvidersQuerySchema, type WatchProvidersResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';
import { regionInfo, watchRegionConfig } from '@/server/region';

/**
 * GET /api/watch/providers?region=US (API_CONTRACT §5.23, ADR-013 C-02): browse chips, <= 6 by TMDB
 * priority in the region, each with >= 1 listed title. Public and CDN-cached per URL (tag
 * `watch-providers`); reads no cookie. An unsupported region answers for the default region.
 */
export const GET = route(async (req) => {
  const q = parseQuery(req, watchProvidersQuerySchema);
  const region = regionInfo(q.region, 'query', watchRegionConfig()).region;
  const body: WatchProvidersResponse = { region, providers: await dal.listWatchProviders(region) };
  return json(body, { cache: CACHE.watchProviders });
});
