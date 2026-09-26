/**
 * Detail-page score chips (DESIGN §6, ADR-008): TMDB (+ votes), IMDb (+ votes, "IMDb rating · via
 * OMDb", read-only link out; hidden when unknown), Stubbed community average (unlocks at 5 ratings).
 * Rendered only from titleScores() — never a blended number.
 */
import { formatScore, IMDB_SOURCE_LABEL, titleScores } from '@/lib/format';
import { imdbTitleHref } from '@/lib/routes';
import type { TitleStats, TitleSummary } from '@/lib/types';
import { STUBBED_MIN_RATINGS } from '@/lib/worth-it';
import { Icon } from './Icon';
import styles from './ScoreChips.module.css';

export function ScoreChips({
  title,
  stats,
}: {
  title: Pick<TitleSummary, 'voteAverage' | 'voteCount' | 'imdbRating' | 'imdbVotes' | 'imdbId'>;
  stats: TitleStats | null;
}) {
  const scores = titleScores(title);
  const imdbHref = imdbTitleHref(title.imdbId);
  return (
    <ul className={styles.scores} aria-label="Ratings">
      {scores.map((s) =>
        s.source === 'tmdb' ? (
          <li key="tmdb" className={styles.score} data-testid="tmdb-rating">
            <b aria-hidden="true">{s.value}</b>
            <span className="sr-only">{s.ariaLabel}</span>
            <span className={styles.lbl} aria-hidden="true">
              <span className={styles.src}>TMDB</span>
              <span>{s.votes}</span>
            </span>
          </li>
        ) : (
          <li key="imdb" className={styles.score} data-testid="imdb-rating">
            <span className="imdb-mark" aria-hidden="true">
              IMDb
            </span>
            <b aria-hidden="true">{s.value}</b>
            <span className={styles.lbl} aria-hidden="true">
              <span>{IMDB_SOURCE_LABEL}</span>
              <span>{s.votes ?? ' '}</span>
            </span>
            <span className="sr-only">{s.ariaLabel}. IMDb rating via OMDb.</span>
            {imdbHref && (
              <a
                className={styles.ext}
                href={imdbHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open on IMDb (new tab)"
              >
                <Icon name="ext" size={14} />
              </a>
            )}
          </li>
        ),
      )}
      {stats && (
        <li className={styles.score} data-testid="stubbed-rating">
          {stats.ratingAvg10 !== null ? (
            <>
              <b>{formatScore(stats.ratingAvg10)}</b>
              <span className={styles.lbl}>
                <span className={styles.src}>STUBBED</span>
                <span>
                  {stats.ratingCount} rating{stats.ratingCount === 1 ? '' : 's'}
                </span>
              </span>
            </>
          ) : (
            <>
              <b>{stats.reviewCount}</b>
              <span className={styles.lbl}>
                <span className={styles.src}>STUBBED</span>
                <span>
                  review{stats.reviewCount === 1 ? '' : 's'} · avg unlocks at {STUBBED_MIN_RATINGS}
                </span>
              </span>
            </>
          )}
        </li>
      )}
    </ul>
  );
}
