import { upsertReviewSchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { recordEvent } from '@/server/events';
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
  // ADR-013 C-09: `review_saved` on create or a content change. A content change stamps
  // `editedAt = updatedAt` in this write (trigger / memory repo); a re-save or stub re-link doesn't.
  if (body.created) recordEvent('review_saved', 'new');
  else if (body.review.editedAt && body.review.editedAt === body.review.updatedAt)
    recordEvent('review_saved', 'edit');
  revalidateAfterWrite([TAGS.titleReviews(body.review.titleKey), TAGS.user(session.user.handle)]);
  return json(body, { status: body.created ? 201 : 200 });
});
