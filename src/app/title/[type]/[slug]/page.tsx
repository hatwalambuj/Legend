import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { CastList } from '@/components/CastList';
import { formatDate } from '@/components/lib/display';
import { safe } from '@/components/lib/safe';
import { Reviews } from '@/components/Reviews';
import { ScoreChips } from '@/components/ScoreChips';
import { stubTarget, Ticket } from '@/components/Ticket';
import { TitleActions } from '@/components/TitleActions';
import { WorthIt } from '@/components/WorthIt';
import { paletteOrDefault, tmdbImage } from '@/lib/images';
import { isMediaType, parseTitleSlug, titleHref } from '@/lib/routes';
import type { TitleDetail } from '@/lib/types';
import { formatRuntime } from '@/lib/worth-it';
import { dal } from '@/server/dal';
import styles from './title.module.css';

// OWNER: Frontend. Title detail (DESIGN §7.4, §7.4.1, §7.5).
export const dynamic = 'force-dynamic';

type Params = Promise<{ type: string; slug: string }>;

const load = cache(async (type: string, slug: string): Promise<TitleDetail | null> => {
  const parsed = parseTitleSlug(slug);
  if (!isMediaType(type) || !parsed) return null;
  return dal.getTitle(type, parsed.tmdbId);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type, slug } = await params;
  const t = await load(type, slug);
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

export async function generateViewport({ params }: { params: Params }): Promise<Viewport> {
  const { type, slug } = await params;
  const t = await load(type, slug);
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

export default async function TitlePage({ params }: { params: Params }) {
  const { type, slug } = await params;
  const t = await load(type, slug);
  if (!t) notFound();
  if (parseTitleSlug(slug)?.slug !== t.slug) permanentRedirect(titleHref(t));

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

  return (
    <>
      <AdaptiveBackground palette={palette} />
      <div className="wrap">
        <div className={styles.detail}>
          <div className={styles.ticket} data-hero="">
            <Ticket title={t} variant="hero" priority />
          </div>
          <div className={styles.info}>
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
            <ScoreChips title={t} stats={stats} />
            <TitleActions target={target} />
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
            />
          </div>
        </div>
      </div>
    </>
  );
}
