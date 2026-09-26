import { signInSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): container().auth.signIn → AuthResponse. Generic invalid_credentials on any failure.
export const POST = route(async (req) => {
  await parseBody(req, signInSchema);
  return notImplementedRoute();
});
