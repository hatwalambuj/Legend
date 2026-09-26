import { createStubSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): create stub → 201 StubMutationResponse. Rate limit 30/min.
export const POST = route(async (req) => {
  await parseBody(req, createStubSchema);
  return notImplementedRoute();
});
