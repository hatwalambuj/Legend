import { catalogQuerySchema, type CatalogResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';

/**
 * GET /api/catalog (API_CONTRACT §5.3). v1.6: `region` → items carry `watchHint` and the effective
 * region is echoed; `provider` (needs `region`) filters. Never reads a cookie, so the URL keys the cache.
 */
export const GET = route(async (req) => {
  const q = parseQuery(req, catalogQuerySchema);
  const body: CatalogResponse = await dal.listCatalog({
    type: q.type,
    sort: q.sort,
    genreIds: q.genre,
    cursor: q.cursor,
    limit: q.limit,
    ...(q.region ? { region: q.region } : {}),
    ...(q.provider ? { provider: q.provider } : {}),
  });
  return json(body, { cache: CACHE.catalog });
});
