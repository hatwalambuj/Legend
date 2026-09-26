import { imdbSharedSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

// TODO(Backend): set/clear imdb_shared_at on own review → ReviewResponse. Only when the user confirms (D3-AC4).
export const POST = route<Ctx>(async (req) => {
  await parseBody(req, imdbSharedSchema);
  return notImplementedRoute();
});
