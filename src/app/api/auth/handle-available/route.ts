import {
  handleAvailableQuerySchema,
  handleSchema,
  type HandleAvailableResponse,
} from '@/lib/contracts';
import { container } from '@/server/container';
import { json, parseQuery, route } from '@/server/http';

export const GET = route(async (req) => {
  const { handle } = parseQuery(req, handleAvailableQuerySchema);
  const valid = handleSchema.safeParse(handle);
  const body: HandleAvailableResponse = valid.success
    ? (await container().auth.isHandleAvailable(valid.data))
      ? { available: true }
      : { available: false, reason: 'That handle is taken.' }
    : { available: false, reason: valid.error.issues[0]?.message ?? 'Invalid handle' };
  return json(body);
});
