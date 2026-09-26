import type { Metadata } from 'next';
import Link from 'next/link';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { TypeFilterLinks } from '@/components/TypeFilterLinks';
import { EmptyState } from '@/components/EmptyState';
import { first, type SearchParams } from '@/components/lib/params';
import { SearchPanel } from '@/components/SearchPanel';
import { TicketGrid } from '@/components/TicketGrid';
import { NEUTRAL_PALETTE, paletteOrDefault } from '@/lib/images';
import type { SearchResult, TypeFilter } from '@/lib/types';
import { dal } from '@/server/dal';

// OWNER: Frontend. Search (DESIGN §7.3): ?q=&type=. "Not in Stubbed" is an empty state, never an error.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const q = first((await searchParams).q)?.trim();
  return { title: q ? `“${q}”` : 'Search', robots: { index: false } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = (first(sp.q) ?? '').slice(0, 100);
  const t = first(sp.type);
  const type: TypeFilter = t === 'movie' || t === 'tv' ? t : 'all';
  const { res, failed }: { res: SearchResult | null; failed: boolean } = q.trim()
    ? await dal.searchCatalog(q, type, 40).then(
        (r) => ({ res: r, failed: false }),
        (e: unknown) => {
          console.error('[search] failed', e);
          return { res: null, failed: true };
        },
      )
    : { res: null, failed: false };
  const top = res?.items[0];
  const palette = top
    ? paletteOrDefault(
        top.palette,
        top.genres.map((g) => g.id),
      )
    : NEUTRAL_PALETTE;

  return (
    <>
      <AdaptiveBackground palette={palette} follow />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">Only titles rated 6.5+</div>
          <h1>Search</h1>
        </div>
        <SearchPanel q={q} type={type} />
        <TypeFilterLinks q={q} type={type} />
        {failed ? (
          <EmptyState title="The projector jammed">We couldn&apos;t search right now. Try again.</EmptyState>
        ) : res ? (
          res.items.length ? (
            <>
              <p className="mono" style={{ fontSize: 12, letterSpacing: '.06em', color: 'var(--fg-2)' }} aria-live="polite">
                {res.items.length} RESULT{res.items.length === 1 ? '' : 'S'} FOR “{q.toUpperCase()}”
              </p>
              <TicketGrid titles={res.items} label={`Results for ${q}`} />
            </>
          ) : (
            <div style={{ paddingTop: 16 }}>
              <EmptyState
                title="Not in Stubbed"
                testId="not-in-catalog"
                action={
                  <Link href="/search" className="btn btn--ghost">
                    Clear search
                  </Link>
                }
              >
                We only list titles rated 6.5+ on TMDB. “{q}” didn&apos;t make the cut, or we
                don&apos;t have it yet.
              </EmptyState>
            </div>
          )
        ) : null}
      </div>
    </>
  );
}
