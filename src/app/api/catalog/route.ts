import { catalogQuerySchema, type CatalogResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { CACHE, json, parseQuery, route } from '@/server/http';

export const GET = route(async (req) => {
  const q = parseQuery(req, catalogQuerySchema);
  const body: CatalogResponse = await dal.listCatalog({
    type: q.type,
    sort: q.sort,
    genreIds: q.genre,
    cursor: q.cursor,
    limit: q.limit,
  });
  return json(body, { cache: CACHE.catalog });
});
