/** Gathers a user's data for GET /api/me/export (API_CONTRACT §5.16). OWNER: Backend. */
import { AppError } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { buildJsonExport, buildLetterboxdCsv, drain } from '@/server/export/letterboxd';
import type { Container } from '@/server/ports';
import { LIMITS, enforce } from '@/server/rate-limit';

export interface ExportFile {
  body: string;
  contentType: string;
  filename: string;
}

export async function buildExport(
  c: Container,
  session: Session,
  format: 'letterboxd' | 'json',
  today: string,
  now: () => Date = () => new Date(),
): Promise<ExportFile> {
  enforce(
    await c.rateLimiter.consume(
      // Per format, so "download CSV" and "download JSON" from settings both work (1 each / 10 min).
      `export_${format}:${session.user.id}`,
      LIMITS.export.max,
      LIMITS.export.windowSec,
    ),
    'You can export once every 10 minutes. Try again shortly.',
  );
  const uid = session.user.id;
  const [profile, stubs, reviews] = await Promise.all([
    c.profiles.getById(uid),
    drain((cursor) => c.stubs.diary(uid, { type: 'all', cursor, limit: 50 })),
    drain((cursor) => c.reviews.listForUser(uid, { cursor, limit: 50 })),
  ]);
  if (!profile) throw new AppError('not_found', 'Profile not found.');
  if (format === 'letterboxd')
    return {
      body: buildLetterboxdCsv(stubs, reviews),
      contentType: 'text/csv; charset=utf-8',
      filename: `stubbed-letterboxd-${today}.csv`,
    };
  const [watchlist, settings] = await Promise.all([
    drain((cursor) => c.watchlist.list(uid, { cursor, limit: 50 })),
    c.settings.get(uid),
  ]);
  const data = buildJsonExport({
    exportedAt: now().toISOString(),
    profile,
    stubs,
    reviews,
    watchlist,
    settings,
  });
  return {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json; charset=utf-8',
    filename: `stubbed-export-${today}.json`,
  };
}
