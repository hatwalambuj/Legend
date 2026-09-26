import { assertSameOrigin, notImplementedRoute, route } from '@/server/http';

// TODO(Backend): clear session → 204.
export const POST = route(async (req) => {
  assertSameOrigin(req);
  return notImplementedRoute();
});
