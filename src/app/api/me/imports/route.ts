import { importCommitSchema, type ImportCommitResponse } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { recordEvent } from '@/server/events';
import { json, parseBodyLimited, route } from '@/server/http';
import { commitImport } from '@/server/imports/commit';
import { TAGS, revalidateAfterWrite } from '@/server/revalidate';
import { requireSession } from '@/server/session';

/** ≤ 1 MB per chunk (≤ 1000 rows; the UI sends 500). */
const MAX_BYTES = 1024 * 1024;

/**
 * POST /api/me/imports (API_CONTRACT §5.27, ADR-013 C-11): one chunk. Stateless re-match, idempotent per
 * (user, import_key), never overwrites a review. `final: true` records `import_completed`.
 */
export const POST = route(async (req) => {
  const c = container();
  const session = await requireSession(c);
  const input = await parseBodyLimited(req, importCommitSchema, MAX_BYTES);
  const { final, ...result } = await commitImport(c, session, input, today());
  if (result.created.stubs + result.created.reviews > 0)
    revalidateAfterWrite([TAGS.user(session.user.handle)]);
  if (final) recordEvent('import_completed', input.source);
  const body: ImportCommitResponse = result;
  return json(body);
});
