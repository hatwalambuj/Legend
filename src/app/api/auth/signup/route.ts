import { signUpSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): container().auth.signUp → 201 AuthResponse (sets session cookie).
export const POST = route(async (req) => {
  await parseBody(req, signUpSchema);
  return notImplementedRoute();
});
