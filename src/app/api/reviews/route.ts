import { upsertReviewSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): upsert own review → ReviewUpsertResponse (201 when created, 200 when updated). Rate limit 10/min.
export const PUT = route(async (req) => {
  await parseBody(req, upsertReviewSchema);
  return notImplementedRoute();
});
