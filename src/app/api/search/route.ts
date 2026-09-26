import { searchQuerySchema, type SearchResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';

export const GET = route(async (req) => {
  const q = parseQuery(req, searchQuerySchema);
  const body: SearchResponse = await dal.searchCatalog(q.q, q.type, q.limit);
  return json(body, { cache: CACHE.search });
});
