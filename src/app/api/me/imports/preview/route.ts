import { importPreviewSchema, type ImportPreviewResponse } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { json, parseBodyLimited, route } from '@/server/http';
import { previewImport } from '@/server/imports/commit';
import { requireSession } from '@/server/session';

/** ≤ 4 MB (rows without review bodies). */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/me/imports/preview (API_CONTRACT §5.26, ADR-013 C-11): counts + a sample of what an import
 * would create. Writes nothing. Matches only against our catalogue (no outbound call).
 */
export const POST = route(async (req) => {
  const c = container();
  const session = await requireSession(c);
  const input = await parseBodyLimited(req, importPreviewSchema, MAX_BYTES);
  const body: ImportPreviewResponse = await previewImport(c, session, input, today());
  return json(body);
});
