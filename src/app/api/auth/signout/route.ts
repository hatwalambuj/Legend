import { container } from '@/server/container';
import { assertSameOrigin, noContent, route } from '@/server/http';

/** POST /api/auth/signout → 204 and clears the session cookie (idempotent when signed out). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await container().auth.signOut();
  return noContent();
});
