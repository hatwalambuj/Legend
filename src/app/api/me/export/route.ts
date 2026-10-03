import { NextResponse } from 'next/server';
import { exportQuerySchema } from '@/lib/contracts';
import { container } from '@/server/container';
import { today } from '@/server/env';
import { recordEvent } from '@/server/events';
import { CACHE, parseQuery, route } from '@/server/http';
import { buildExport } from '@/server/services/export';
import { requireSession } from '@/server/session';

export const dynamic = 'force-dynamic';

/** GET /api/me/export?format=letterboxd|json → attachment (API_CONTRACT §5.16). 1 per 10 min. */
export const GET = route(async (req) => {
  const c = container();
  const session = await requireSession(c);
  const { format } = parseQuery(req, exportQuerySchema);
  const file = await buildExport(c, session, format, today());
  recordEvent('export_downloaded', format);
  return new NextResponse(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': CACHE.private,
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
