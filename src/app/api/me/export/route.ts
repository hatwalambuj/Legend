import { exportQuerySchema } from '@/lib/contracts';
import { notImplementedRoute, parseQuery, route } from '@/server/http';

// TODO(Backend): stream Letterboxd CSV / JSON as an attachment (API_CONTRACT §5.16).
export const GET = route(async (req) => {
  parseQuery(req, exportQuerySchema);
  return notImplementedRoute();
});
