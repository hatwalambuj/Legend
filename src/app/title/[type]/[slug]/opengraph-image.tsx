/**
 * Title og:image + twitter fallback, 1200×630 PNG (ADR-013 C-08, A5-AC3). The file convention sets the
 * meta tags; generateMetadata sets no openGraph.images. Palette fallback when there's no poster; no
 * fetch in demo/placeholder image mode. OWNER: Frontend.
 */
import { notFound } from 'next/navigation';
import { isMediaType, parseTitleSlug } from '@/lib/routes';
import { BRAND_NAME } from '@/lib/brand';
import { OgCard } from '@/og/ShareCard';
import { renderCard, siteHost, titleCardProps } from '@/og/render';
import { dal } from '@/server/dal';

export const revalidate = 86400;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `Ticket on ${BRAND_NAME}`;

export default async function Image({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { type, slug } = await params;
  const parsed = parseTitleSlug(slug);
  if (!isMediaType(type) || !parsed) notFound();
  const t = await dal.getTitle(type, parsed.tmdbId);
  if (!t) notFound();
  const props = await titleCardProps(t, siteHost());
  return renderCard(<OgCard {...props} />, 'og', {
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
  });
}
