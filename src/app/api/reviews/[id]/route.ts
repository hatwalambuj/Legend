import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { container } from '@/server/container';
import { assertSameOrigin, noContent, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { deleteReview } from '@/server/services/reviews';
import { requireSession } from '@/server/session';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/reviews/{id} → 204. Someone else's (or an unknown) review → 404. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new AppError('not_found', "This review doesn't exist.");
  await deleteReview(c, session, id.data);
  revalidateAfterWrite([TAGS.user(session.user.handle)]);
  return noContent();
});
