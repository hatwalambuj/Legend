import type { MeResponse } from '@/lib/contracts';
import { container } from '@/server/container';
import { dal } from '@/server/dal';
import { json, route } from '@/server/http';

/** GET /api/me → session, mode and the wallet-badge stub count (one indexed count, not a diary walk). */
export const GET = route(async () => {
  const session = await dal.getSession();
  const stubCount = session ? await container().stubs.count(session.user.id) : 0;
  const body: MeResponse = { session, mode: dal.getMode(), stubCount };
  return json(body);
});
