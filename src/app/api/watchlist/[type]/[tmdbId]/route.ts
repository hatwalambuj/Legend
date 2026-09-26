import { z } from 'zod';
import { assertSameOrigin, notImplementedRoute, parseBody, route } from '@/server/http';

type Ctx = { params: Promise<{ type: string; tmdbId: string }> };

// TODO(Backend): PUT adds (idempotent), DELETE removes → WatchlistResponse.
export const PUT = route<Ctx>(async (req) => {
  await parseBody(req, z.object({}).passthrough());
  return notImplementedRoute();
});

export const DELETE = route<Ctx>(async (req) => {
  assertSameOrigin(req);
  return notImplementedRoute();
});
