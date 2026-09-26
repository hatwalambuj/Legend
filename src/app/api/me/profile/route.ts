import { updateProfileSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): update own profile (handle is immutable) → ProfileResponse.
export const PATCH = route(async (req) => {
  await parseBody(req, updateProfileSchema);
  return notImplementedRoute();
});
