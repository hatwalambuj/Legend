import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { BrowseSection } from '@/components/BrowseSection';
import { TicketRail } from '@/components/TicketGrid';
import { parseBrowse, SORT_ASIDE, type SearchParams } from '@/components/lib/params';
import { safe } from '@/components/lib/safe';
import { NEUTRAL_PALETTE, paletteOrDefault } from '@/lib/images';
import type { Page, TitleSummary } from '@/lib/types';
import { dal } from '@/server/dal';
import styles from './home.module.css';

// OWNER: Frontend. Home / Discover (DESIGN §7.1): hero, trending rail, browse grid.
export const dynamic = 'force-dynamic';

const EMPTY: Page<TitleSummary> = { items: [], nextCursor: null, total: 0 };

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { type, sort } = parseBrowse(await searchParams);
  // ADR-013 C-01: the request's watch region → stub logos (`watchHint`); never fails the page.
  const region = await dal.getWatchRegion().then(
    (r) => r.region,
    () => undefined,
  );
  const [trending, { page, failed }] = await Promise.all([
    safe(dal.listTrending('all', 10, { region }), [], 'listTrending'),
    dal.listCatalog({ type, sort, limit: 20, region }).then(
      (page) => ({ page, failed: false }),
      (e: unknown) => {
        console.error('[home] listCatalog failed', e);
        return { page: EMPTY, failed: true };
      },
    ),
  ]);
  const hero = trending[0];
  const palette = hero
    ? paletteOrDefault(
        hero.palette,
        hero.genres.map((g) => g.id),
      )
    : NEUTRAL_PALETTE;

  return (
    <>
      <AdaptiveBackground palette={palette} follow />
      <div className="wrap">
        <section className={styles.hero} aria-labelledby="home-h">
          <div className="eyebrow">Movies + shows · rated 6.5 and up</div>
          <h1 id="home-h">
            Only the <em>good</em> stuff.
          </h1>
          <p>Every title here clears 6.5 on TMDB. Watch it, stub it, keep the proof.</p>
        </section>

        {trending.length > 0 && (
          <section aria-labelledby="trending-h">
            <div className="sec-h">
              <h2 id="trending-h">Trending this week</h2>
              <span className="aside" aria-hidden="true">
                Swipe →
              </span>
            </div>
            <TicketRail titles={trending} label="Trending this week" />
          </section>
        )}

        <section aria-labelledby="browse-h">
          <div className="sec-h">
            <h2 id="browse-h">Browse</h2>
            <span className="aside">{SORT_ASIDE[sort]}</span>
          </div>
          <BrowseSection
            base="/"
            type={type}
            sort={sort}
            page={page}
            headingId="browse-h"
            failed={failed}
            region={region}
          />
        </section>
      </div>
    </>
  );
}
