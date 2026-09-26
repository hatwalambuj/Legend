/**
 * The ticket card (DESIGN §3) in grid / rail / hero variants. Isomorphic (no 'use client'): it renders
 * on the server for pages and inside client lists ("Load more"). Personal bits are client leaves.
 */
import Link from 'next/link';
import { ticketAccessibleName, titleScores } from '@/lib/format';
import { paletteOrDefault } from '@/lib/images';
import { titleHref } from '@/lib/routes';
import type { TitleSummary } from '@/lib/types';
import { ticketTimeLabel } from '@/lib/worth-it';
import type { StubTarget } from '@/hooks/useApp';
import { stubPrint, ticketSerial } from './lib/display';
import { Poster } from './Poster';
import { StubButton } from './StubButton';
import { HeroCount, StubStamp, WatchMark } from './TicketPersonal';
import styles from './Ticket.module.css';

export type TicketVariant = 'grid' | 'rail' | 'hero';

export function stubTarget(t: TitleSummary): StubTarget {
  return { key: t.key, mediaType: t.mediaType, tmdbId: t.tmdbId, title: t.title, year: t.year };
}

/** data-* attributes the adaptive background follows on hover/focus (DESIGN §4.1). */
export function tintAttrs(t: Pick<TitleSummary, 'palette' | 'genres'>) {
  const p = paletteOrDefault(
    t.palette,
    t.genres.map((g) => g.id),
  );
  return { 'data-tint1': p.tint1, 'data-tint2': p.tint2, 'data-lqip': p.lqip ?? '' };
}

export function Ticket({
  title: t,
  variant = 'grid',
  rank,
  priority = false,
}: {
  title: TitleSummary;
  variant?: TicketVariant;
  rank?: number;
  priority?: boolean;
}) {
  const scores = titleScores(t);
  const tmdb = scores.find((s) => s.source === 'tmdb');
  const imdb = scores.find((s) => s.source === 'imdb');
  const hero = variant === 'hero';
  const poster = (
    <Poster
      title={t.title}
      posterPath={t.posterPath}
      palette={t.palette}
      genreIds={t.genres.map((g) => g.id)}
      size={hero ? 'w500' : 'w342'}
      alt={hero ? `Poster for ${t.title}` : ''}
      priority={priority}
    />
  );

  return (
    <div className={`${styles.tw} ${styles[variant]}`} {...tintAttrs(t)}>
      <article className={styles.ticket} data-ticket={t.key} data-testid={`ticket-${t.key}`}>
        {hero ? (
          <div className={styles.body}>{poster}</div>
        ) : (
          <Link className={styles.body} href={titleHref(t)} aria-label={ticketAccessibleName(t)}>
            {poster}
          </Link>
        )}
        <span className={styles.typeRow} aria-hidden={hero ? undefined : true}>
          <span className={styles.typePill}>{t.mediaType === 'tv' ? 'SHOW' : 'MOVIE'}</span>
          {!hero && <WatchMark titleKey={t.key} />}
        </span>
        {rank !== undefined && (
          <span className={styles.rank} aria-hidden="true">
            {rank}
          </span>
        )}
        {variant !== 'rail' && <StubStamp titleKey={t.key} />}
        <div className={styles.stub} data-stub-paper="">
          <div className={styles.stubTitle}>{t.title}</div>
          <div className={styles.time} data-testid="ticket-time">
            {ticketTimeLabel(t)}
          </div>
          <div className={styles.scores}>
            {tmdb && (
              <span className={styles.score} data-testid="tmdb-rating">
                {tmdb.value}
                <small>TMDB</small>
              </span>
            )}
            {imdb && (
              <span className={styles.imdb} data-testid="imdb-rating">
                <span className="imdb-mark imdb-mark--xs" aria-hidden="true">
                  IMDb
                </span>
                {imdb.value}
                <span className="sr-only"> on IMDb</span>
              </span>
            )}
          </div>
          <div className={styles.foot}>
            <span className={`${styles.serial} ${t.isListed ? '' : styles.below}`}>
              {t.isListed ? stubPrint(t) : 'BELOW 6.5 NOW'}
              {hero && t.isListed && ` · № ${ticketSerial(t.tmdbId)}`}
            </span>
            {hero ? <HeroCount titleKey={t.key} /> : <StubButton target={stubTarget(t)} />}
          </div>
        </div>
      </article>
    </div>
  );
}

export function TicketSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`${styles.sk} ${className}`} aria-hidden="true">
      <div className={styles.skPoster} />
      <div className={styles.skStub}>
        <i style={{ width: '80%' }} />
        <i style={{ width: '40%', height: 20 }} />
        <i style={{ width: '60%' }} />
      </div>
    </div>
  );
}
