import { updateProfileSchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { updateProfile } from '@/server/services/reviews';
import { requireSession } from '@/server/session';

/** PATCH /api/me/profile → 200 ProfileResponse. The handle is immutable. */
export const PATCH = route(async (req) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const patch = await parseBody(req, updateProfileSchema);
  const body = await updateProfile(c, session, patch);
  revalidateAfterWrite([TAGS.user(session.user.handle)]);
  return json(body);
});
