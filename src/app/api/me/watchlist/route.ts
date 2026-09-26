import { z } from 'zod';
import { cursorSchema, limitSchema, type WatchlistListResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { json, parseQuery, route } from '@/server/http';

export const GET = route(async (req) => {
  const q = parseQuery(req, z.object({ cursor: cursorSchema, limit: limitSchema }));
  const body: WatchlistListResponse = await dal.myWatchlist(q);
  return json(body);
});
