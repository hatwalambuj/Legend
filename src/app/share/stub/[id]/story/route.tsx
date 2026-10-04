/**
 * Story share image, 1080×1920 PNG (ADR-013 C-08). Canonical URL `?v=<version>[&download=1]`
 * (src/server/share-cache.ts; anything else → 308). `download=1` → attachment
 * "{brand}-stub-{n}.png". 404 for an unknown/deleted stub. No cookies are read or set. OWNER: Frontend
 * (the one route.tsx frontend owns, WORK_SPLIT §7 C-08b).
 */
import { storyFileName } from '@/components/lib/display';
import { StoryCard } from '@/og/ShareCard';
import { renderCard, stubCardProps } from '@/og/render';
import { dal } from '@/server/dal';
import { SHARE_CACHE_CONTROL, shareImageRedirect } from '@/server/share-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Canonical cache key (R1): src/proxy.ts redirects first; this guards a request that skipped it.
  const url = new URL(req.url);
  const to = shareImageRedirect(url);
  if (to) {
    return new Response(null, {
      status: 308,
      headers: { Location: to.toString(), 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    });
  }
  const { id } = await ctx.params;
  const share = await dal.getStubShare(id);
  if (!share) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  }
  const props = await stubCardProps(share);
  const headers: Record<string, string> = { 'Cache-Control': SHARE_CACHE_CONTROL.story };
  if (url.searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="${storyFileName(share.number)}"`;
  }
  return renderCard(<StoryCard {...props} stub={props.stub!} />, 'story', headers);
}
