import { diaryQuerySchema, type DiaryResponse } from '@/lib/contracts';
import { container } from '@/server/container';
import { json, parseQuery, route } from '@/server/http';
import { requireSession } from '@/server/session';

/** GET /api/me/stubs?type=&cursor=&limit= → the signed-in user's diary, newest first. */
export const GET = route(async (req) => {
  const c = container();
  const session = await requireSession(c);
  const q = parseQuery(req, diaryQuerySchema);
  const body: DiaryResponse = await c.stubs.diary(session.user.id, {
    type: q.type,
    cursor: q.cursor,
    limit: q.limit,
  });
  return json(body);
});
