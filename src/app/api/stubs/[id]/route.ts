import { updateStubSchema } from '@/lib/contracts';
import { assertSameOrigin, notImplementedRoute, parseBody, route } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };

// TODO(Backend): PATCH → StubMutationResponse; DELETE → StubDeleteResponse (used by Undo).
export const PATCH = route<Ctx>(async (req) => {
  await parseBody(req, updateStubSchema);
  return notImplementedRoute();
});

export const DELETE = route<Ctx>(async (req) => {
  assertSameOrigin(req);
  return notImplementedRoute();
});
