import { createStubSchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { recordEvent } from '@/server/events';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { createStub } from '@/server/services/stubs';
import { requireSession } from '@/server/session';

/** POST /api/stubs → 201 StubMutationResponse. Not idempotent: each call is one more watch. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const input = await parseBody(req, createStubSchema);
  const body = await createStub(c, session, input, today());
  revalidateAfterWrite([TAGS.titleReviews(body.stub.titleKey), TAGS.user(session.user.handle)]);
  // ADR-013 C-09: anonymous daily counters, written after the response.
  recordEvent('stub_created');
  if (body.stub.number > 1) recordEvent('stub_again');
  return json(body, { status: 201 });
});
