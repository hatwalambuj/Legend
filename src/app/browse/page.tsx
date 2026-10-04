import type { Metadata } from 'next';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { BrowseSection } from '@/components/BrowseSection';
import { parseBrowse, SORT_ASIDE, type SearchParams } from '@/components/lib/params';
import { safe } from '@/components/lib/safe';
import { NEUTRAL_PALETTE, paletteOrDefault } from '@/lib/images';
import type { Page, TitleSummary } from '@/lib/types';
import { dal } from '@/server/dal';

// OWNER: Frontend. Full browse view (API_CONTRACT §7): ?type=&sort=&cursor= (cursor = no-JS paging).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Browse',
  description: 'Every movie and show rated 6.5+ on TMDB, sorted by release date or rating.',
};

const EMPTY: Page<TitleSummary> = { items: [], nextCursor: null, total: 0 };

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { type, sort, cursor, provider: asked } = parseBrowse(await searchParams);
  // ADR-013 C-01: the request's watch region → stub logos (`watchHint`); never fails the page.
  const region = await dal.getWatchRegion().then(
    (r) => r.region,
    () => undefined,
  );
  // ADR-013 C-02: "On {Service}" chips; a provider filter only applies with a region.
  const provider = region ? asked : null;
  const [chips, { page, failed }] = await Promise.all([
    region ? safe(dal.listWatchProviders(region), [], 'listWatchProviders') : [],
    dal
      .listCatalog({ type, sort, cursor, limit: 20, region, ...(provider ? { provider } : {}) })
      .then(
        (page) => ({ page, failed: false }),
        (e: unknown) => {
          console.error('[browse] listCatalog failed', e);
          return { page: EMPTY, failed: true };
        },
      ),
  ]);
  const first = page.items[0];
  const palette = first
    ? paletteOrDefault(
        first.palette,
        first.genres.map((g) => g.id),
      )
    : NEUTRAL_PALETTE;
  return (
    <>
      <AdaptiveBackground palette={palette} follow />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">{SORT_ASIDE[sort]}</div>
          <h1 id="browse-h">Browse</h1>
          <p>Movies and shows that clear 6.5 on TMDB. Nothing else.</p>
        </div>
        <BrowseSection
          base="/browse"
          type={type}
          sort={sort}
          page={page}
          headingId="browse-h"
          failed={failed}
          region={region}
          provider={provider}
          chips={chips}
        />
      </div>
    </>
  );
}
