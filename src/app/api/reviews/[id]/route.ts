import { assertSameOrigin, notImplementedRoute, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

// TODO(Backend): delete own review → 204.
export const DELETE = route<Ctx>(async (req) => {
  assertSameOrigin(req);
  return notImplementedRoute();
});
