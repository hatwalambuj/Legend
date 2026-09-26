import { z } from 'zod';
import { updateStubSchema, type StubDeleteResponse } from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { assertSameOrigin, json, parseBody, route } from '@/server/http';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { deleteStub, updateStub } from '@/server/services/stubs';
import { requireSession } from '@/server/session';

type Ctx = { params: Promise<{ id: string }> };

/** Malformed ids look exactly like someone else's stub: 404, existence is never leaked. */
async function stubId(ctx: Ctx): Promise<string> {
  const r = z.uuid().safeParse((await ctx.params).id);
  if (!r.success) throw new AppError('not_found', "This stub doesn't exist.");
  return r.data;
}

/** PATCH /api/stubs/{id} → 200 StubMutationResponse. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const id = await stubId(ctx);
  const patch = await parseBody(req, updateStubSchema);
  const body = await updateStub(c, session, id, patch, today());
  revalidateAfterWrite([TAGS.user(session.user.handle)]);
  return json(body);
});

/** DELETE /api/stubs/{id} → 200 StubDeleteResponse (also the Undo of a just-created stub). */
export const DELETE = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const c = container();
  const session = await requireSession(c);
  const id = await stubId(ctx);
  const { state, titleKey } = await deleteStub(c, session, id, today());
  revalidateAfterWrite([TAGS.titleReviews(titleKey), TAGS.user(session.user.handle)]);
  const body: StubDeleteResponse = { state };
  return json(body);
});
