import { upsertReviewSchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { upsertReview } from '@/server/services/reviews';
import { requireSession } from '@/server/session';

/** PUT /api/reviews → 201 (created) | 200 (updated) ReviewUpsertResponse. One review per user per title. */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const input = await parseBody(req, upsertReviewSchema);
  const body = await upsertReview(c, session, input, today());
  revalidateAfterWrite([TAGS.titleReviews(body.review.titleKey), TAGS.user(session.user.handle)]);
  return json(body, { status: body.created ? 201 : 200 });
});
