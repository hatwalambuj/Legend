import { magicLinkSchema } from '@/lib/contracts';
import { notImplementedRoute, parseBody, route } from '@/server/http';

// TODO(Backend): 202 MagicLinkResponse (demo: includes devLink). Never reveal whether the email exists.
export const POST = route(async (req) => {
  await parseBody(req, magicLinkSchema);
  return notImplementedRoute();
});
