import { watchlistQuerySchema, type WatchlistListResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { json, parseQuery, route } from '@/server/http';

/** GET /api/me/watchlist (§5.15). v1.6: optional `region` → `watchHint` on items + `region` echoed. */
export const GET = route(async (req) => {
  const q = parseQuery(req, watchlistQuerySchema);
  const body: WatchlistListResponse = await dal.myWatchlist(q);
  return json(body);
});
