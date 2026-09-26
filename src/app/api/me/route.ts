import { deleteAccountSchema, type MeResponse } from '@/lib/contracts';
import { container } from '@/server/container';
import { dal } from '@/server/dal';
import { json, noContent, parseBody, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { requireSession } from '@/server/session';

/** GET /api/me → session, mode and the wallet-badge stub count (one indexed count, not a diary walk). */
export const GET = route(async () => {
  const session = await dal.getSession();
  const stubCount = session ? await container().stubs.count(session.user.id) : 0;
  const body: MeResponse = { session, mode: dal.getMode(), stubCount };
  return json(body);
});

/**
 * DELETE /api/me { confirm: "DELETE" } → 204 (GAP-06). Same-origin + JSON + session, then the account
 * and everything it owns is erased and the session cookies are cleared. The id comes from the session.
 */
export const DELETE = route(async (req) => {
  await parseBody(req, deleteAccountSchema); // same-origin + application/json + explicit confirm
  const c = container();
  const session = await requireSession(c);
  await c.auth.deleteAccount(session.user.id);
  revalidateAfterWrite([TAGS.user(session.user.handle)]);
  return noContent();
});
