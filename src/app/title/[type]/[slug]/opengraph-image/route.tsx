/**
 * Title og:image, 1200×630 PNG (ADR-013 C-08, A5-AC3). A route handler, not the `opengraph-image.tsx`
 * file convention: the convention emits `?<build hash>` in og:image, which src/proxy.ts would 308 (R1),
 * and some crawlers don't follow og:image redirects. The title page's generateMetadata emits the
 * canonical `?v=<release>-<UTC day>` URL (`canonicalOgImage`), served here with 200 and a long-lived
 * `immutable` cache under that key. Palette fallback when there's no poster; no fetch in
 * demo/placeholder image mode. OWNER: Frontend.
 */
import { isMediaType, parseTitleSlug } from '@/lib/routes';
import { OgCard } from '@/og/ShareCard';
import { renderCard, siteHost, titleCardProps } from '@/og/render';
import { dal } from '@/server/dal';
import {
  notFoundImage,
  redirectImage,
  SHARE_CACHE_CONTROL,
  shareImageRedirect,
} from '@/server/share-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ type: string; slug: string }> }) {
  // Canonical cache key (R1): src/proxy.ts redirects first; this guards a request that skipped it.
  const to = shareImageRedirect(new URL(req.url));
  if (to) return redirectImage(to);
  const { type, slug } = await ctx.params;
  const parsed = parseTitleSlug(slug);
  if (!isMediaType(type) || !parsed) return notFoundImage();
  const t = await dal.getTitle(type, parsed.tmdbId);
  if (!t) return notFoundImage();
  const props = await titleCardProps(t, siteHost());
  return renderCard(<OgCard {...props} />, 'og', {
    'Cache-Control': SHARE_CACHE_CONTROL.title_og,
  });
}
