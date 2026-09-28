import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { CastList } from '@/components/CastList';
import { DegradedBanner } from '@/components/DegradedBanner';
import { formatDate } from '@/components/lib/display';
import { safe } from '@/components/lib/safe';
import { Reviews } from '@/components/Reviews';
import { ScoreChips } from '@/components/ScoreChips';
import { stubTarget, Ticket } from '@/components/Ticket';
import { TitleActions } from '@/components/TitleActions';
import { WhereToWatch } from '@/components/WhereToWatch';
import { WorthIt } from '@/components/WorthIt';
import { paletteOrDefault, tmdbImage } from '@/lib/images';
import { normalizeRegionCode } from '@/lib/regions';
import { isMediaType, parseTitleSlug, titleHref } from '@/lib/routes';
import type { TitleDetail, WatchRegionInfo } from '@/lib/types';
import { formatRuntime } from '@/lib/worth-it';
import { dal } from '@/server/dal';
import { regionInfo, watchRegionConfig } from '@/server/region';
import styles from './title.module.css';

// OWNER: Frontend. Title detail (DESIGN §7.4, §7.4.1, §7.4.2, §7.5).
export const dynamic = 'force-dynamic';

type Params = Promise<{ type: string; slug: string }>;
type Search = Promise<{ region?: string | string[] }>;

/**
 * "Where to watch" region (ADR-012 §5): `?region=GB` (written by the block's switcher, so a shared or
 * reloaded URL shows what the user picked) wins, else the cookie → geo → Accept-Language → default.
 * The page is dynamic and private, so reading the query and cookie never leaks into a shared cache.
 */
async function pageRegion(region: string | undefined): Promise<WatchRegionInfo> {
  const q = normalizeRegionCode(region);
  return q ? regionInfo(q, 'query', watchRegionConfig()) : dal.getWatchRegion();
}

const load = cache(
  async (type: string, slug: string, region?: string): Promise<TitleDetail | null> => {
    const parsed = parseTitleSlug(slug);
    if (!isMediaType(type) || !parsed) return null;
    return dal.getTitle(type, parsed.tmdbId, { region: await pageRegion(region) });
  },
);

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const [{ type, slug }, sp] = await Promise.all([params, searchParams]);
  const t = await load(type, slug, firstParam(sp.region));
  if (!t) return { title: "This ticket doesn't exist" };
  const og = tmdbImage(t.posterPath, 'w780', dal.getMode().images);
  const title = `${t.title} (${t.year})`;
  return {
    title,
    description: t.worthIt.metaDescription,
    alternates: { canonical: titleHref(t) },
    openGraph: {
      title,
      description: t.worthIt.metaDescription,
      type: t.mediaType === 'movie' ? 'video.movie' : 'video.tv_show',
      url: titleHref(t),
      images: og
        ? [{ url: og, width: 780, height: 1170, alt: `Poster for ${t.title}` }]
        : undefined,
    },
  };
}

export async function generateViewport({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Viewport> {
  const [{ type, slug }, sp] = await Promise.all([params, searchParams]);
  const t = await load(type, slug, firstParam(sp.region));
  const p = t
    ? paletteOrDefault(
        t.palette,
        t.genres.map((g) => g.id),
      )
    : null;
  return { themeColor: p?.tint2 ?? '#0B0B0D' };
}

function trailerHref(t: TitleDetail): string | null {
  if (!t.trailer) return null;
  return t.trailer.site === 'YouTube'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(t.trailer.key)}`
    : `https://vimeo.com/${encodeURIComponent(t.trailer.key)}`;
}

export default async function TitlePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const [{ type, slug }, sp] = await Promise.all([params, searchParams]);
  const t = await load(type, slug, firstParam(sp.region));
  if (!t) notFound();
  if (parseTitleSlug(slug)?.slug !== t.slug) {
    const region = normalizeRegionCode(firstParam(sp.region));
    permanentRedirect(region ? `${titleHref(t)}?region=${region}` : titleHref(t));
  }

  const [stats, reviews] = await Promise.all([
    safe(dal.getTitleStats(t.key), null, 'getTitleStats'),
    safe(
      dal.listTitleReviews(t.key, { sort: 'newest', limit: 20 }),
      { items: [], nextCursor: null },
      'listTitleReviews',
    ),
  ]);
  const palette = paletteOrDefault(
    t.palette,
    t.genres.map((g) => g.id),
  );
  const isTv = t.mediaType === 'tv';
  const eyebrow = [
    isTv ? 'Show' : 'Movie',
    String(t.year),
    isTv
      ? t.seasonCount
        ? `${t.seasonCount} season${t.seasonCount === 1 ? '' : 's'}`
        : null
      : t.runtimeMinutes
        ? formatRuntime(t.runtimeMinutes)
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const trailer = trailerHref(t);
  const target = stubTarget(t);
  const overview = t.overview || t.overviewShort;
  // ADR-011 §4: undefined is treated as null; 'catalog' pauses stubs, reviews and watchlist.
  const paused = t.degraded === 'catalog';

  return (
    <>
      <AdaptiveBackground palette={palette} />
      <div className="wrap">
        <DegradedBanner degraded={t.degraded} />
        <div className={styles.detail}>
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            <ol>
              <li>
                <Link href="/">Discover</Link>
              </li>
              <li>
                <Link href={`/browse?type=${t.mediaType}`}>{isTv ? 'Shows' : 'Movies'}</Link>
              </li>
              <li aria-current="page">{t.title}</li>
            </ol>
          </nav>
          <div className={styles.ticket} data-hero="">
            <Ticket title={t} variant="hero" priority />
          </div>
          {/* GAP-01: at < 640px the head sits beside a compact ticket so the scores and Stub it
              land above the fold; from 900px it is the right column as before. */}
          <div className={styles.head}>
            <div className="eyebrow">{eyebrow}</div>
            {!t.isListed && (
              <p className={styles.notice} role="note">
                This title dropped below our 6.5 bar. Your stubs are safe.
              </p>
            )}
            <h1 className={styles.title}>{t.title}</h1>
            {t.genres.length > 0 && (
              <ul className="chips" aria-label="Genres">
                {t.genres.map((g) => (
                  <li key={g.id} className="chip">
                    {g.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.info}>
            <ScoreChips title={t} stats={stats} />
            <TitleActions target={target} paused={paused} />
            {/* DESIGN §7.4.2: under the stubbed line, above Worth it?. null → not rendered (SSR, no CLS). */}
            {t.watch && <WhereToWatch initial={t.watch} target={target} paused={paused} />}
            <WorthIt data={t.worthIt} />
            {t.detailStatus !== 'fresh' && (
              <p className={styles.status}>
                {t.detailStatus === 'stale'
                  ? 'Details may be out of date.'
                  : 'More details unavailable right now.'}
              </p>
            )}
            {overview && <p className={styles.overview}>{overview}</p>}
            <dl className={styles.facts}>
              {t.directors.length > 0 && (
                <div>
                  <dt>
                    {isTv
                      ? t.directors.length > 1
                        ? 'Creators'
                        : 'Creator'
                      : t.directors.length > 1
                        ? 'Directors'
                        : 'Director'}
                  </dt>
                  <dd>{t.directors.join(', ')}</dd>
                </div>
              )}
              <div>
                <dt>{isTv ? 'First aired' : 'Released'}</dt>
                <dd>{formatDate(t.releaseDate)}</dd>
              </div>
              <div>
                <dt>{isTv ? 'Seasons' : 'Runtime'}</dt>
                <dd>
                  {isTv
                    ? (t.seasonCount ?? '—')
                    : t.runtimeMinutes
                      ? formatRuntime(t.runtimeMinutes).toLowerCase()
                      : '—'}
                </dd>
              </div>
              <div>
                <dt>Trailer</dt>
                <dd>
                  {trailer ? (
                    <a
                      className={`link ${styles.trailer}`}
                      href={trailer}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Watch on {t.trailer?.site}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
            <CastList cast={t.cast} />
            <Reviews
              target={target}
              initial={reviews}
              tmdbReviews={t.tmdbReviews}
              reviewCount={stats?.reviewCount ?? reviews.items.length}
              paused={paused}
            />
          </div>
        </div>
      </div>
    </>
  );
}
