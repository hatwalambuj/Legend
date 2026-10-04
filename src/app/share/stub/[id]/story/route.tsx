/**
 * Story share image, 1080×1920 PNG (ADR-013 C-08). `?download=1` → attachment
 * "{brand}-stub-{n}.png". 404 for an unknown/deleted stub. No cookies are read or set. OWNER: Frontend
 * (the one route.tsx frontend owns, WORK_SPLIT §7 C-08b).
 */
import { storyFileName } from '@/components/lib/display';
import { StoryCard } from '@/og/ShareCard';
import { renderCard, stubCardProps } from '@/og/render';
import { dal } from '@/server/dal';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const share = await dal.getStubShare(id);
  if (!share) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  }
  const props = await stubCardProps(share);
  const headers: Record<string, string> = { 'Cache-Control': 'public, s-maxage=600' };
  if (new URL(req.url).searchParams.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="${storyFileName(share.number)}"`;
  }
  return renderCard(<StoryCard {...props} stub={props.stub!} />, 'story', headers);
}
