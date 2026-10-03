import { searchQuerySchema, type SearchResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';

/** GET /api/search (§5.4). v1.6: optional `region` → `watchHint` on items + `region` echoed. */
export const GET = route(async (req) => {
  const q = parseQuery(req, searchQuerySchema);
  const body: SearchResponse = await dal.searchCatalog(q.q, q.type, q.limit, {
    region: q.region,
  });
  return json(body, { cache: CACHE.search });
});
