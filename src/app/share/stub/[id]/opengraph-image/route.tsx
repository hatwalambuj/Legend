/**
 * Shared stub og:image, 1200×630 PNG (ADR-013 C-08). `s-maxage=600`, no swr: a deleted stub is gone
 * within 10 minutes. A route handler (not the file convention) so the landing's generateMetadata can
 * emit the canonical `?v=<10-min version>` URL that src/proxy.ts serves with 200 (R1). Never prints a
 * note or review text (`dal.getStubShare` doesn't return them). OWNER: Frontend.
 */
import { OgCard } from '@/og/ShareCard';
import { renderCard, stubCardProps } from '@/og/render';
import { dal } from '@/server/dal';
import {
  notFoundImage,
  redirectImage,
  SHARE_CACHE_CONTROL,
  shareImageRedirect,
} from '@/server/share-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const to = shareImageRedirect(new URL(req.url));
  if (to) return redirectImage(to);
  const { id } = await ctx.params;
  const share = await dal.getStubShare(id);
  if (!share) return notFoundImage();
  return renderCard(<OgCard {...await stubCardProps(share)} />, 'og', {
    'Cache-Control': SHARE_CACHE_CONTROL.stub_og,
  });
}
