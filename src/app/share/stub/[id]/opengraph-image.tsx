/**
 * Shared stub og:image, 1200×630 PNG (ADR-013 C-08). `s-maxage=600`, no swr: a deleted stub is gone
 * within 10 minutes. Never prints a note or review text (`dal.getStubShare` doesn't return them).
 * OWNER: Frontend.
 */
import { notFound } from 'next/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { OgCard } from '@/og/ShareCard';
import { renderCard, stubCardProps } from '@/og/render';
import { dal } from '@/server/dal';

export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `A ticket stub on ${BRAND_NAME}`;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await dal.getStubShare(id);
  if (!share) notFound();
  return renderCard(<OgCard {...await stubCardProps(share)} />, 'og', {
    'Cache-Control': 'public, s-maxage=600',
  });
}
