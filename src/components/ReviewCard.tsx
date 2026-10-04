/**
 * Review card (DESIGN §6/§7.5). Plain text only (never HTML). Spoilers are blurred and aria-hidden
 * until "Show spoiler" (A6-AC2). TMDB reviews are attributed and read-only.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profileHref } from '@/lib/routes';
import type { Review, TmdbReview } from '@/lib/types';
import { Avatar } from './Avatar';
import { formatDate, starsLabel, starsText } from './lib/display';
import { ReportReview } from './ReportReview';
import { SpoilerBody } from './SpoilerBody';
import styles from './ReviewCard.module.css';

export function ReviewCard({
  review: r,
  eyebrow,
  menu,
  mine = false,
  reportTitle,
}: {
  review: Review;
  eyebrow?: ReactNode;
  menu?: ReactNode;
  mine?: boolean;
  /** "Anora (2024)": shows a "Report" mailto on other people's reviews (GAP-06). */
  reportTitle?: string;
}) {
  return (
    <article className={`${styles.rv} ${mine ? styles.mine : ''}`} data-testid="review-card">
      <Avatar
        handle={r.author.handle}
        name={r.author.displayName}
        color={r.author.avatarColor ?? null}
        size={40}
      />
      <div className={styles.main}>
        {eyebrow}
        <div className={styles.head}>
          <Link href={profileHref(r.author.handle)} className={styles.handle}>
            @{r.author.handle}
          </Link>
          <span className={styles.stars} role="img" aria-label={starsLabel(r.rating10)}>
            {starsText(r.rating10)}
          </span>
          <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
          {mine && <span className="tag">YOU</span>}
          {r.stubNumber && <span className="tag">STUB #{r.stubNumber}</span>}
          {r.editedAt && <span className="tag">EDITED</span>}
          {menu && <span className={styles.menu}>{menu}</span>}
          {!mine && !menu && reportTitle && (
            <span className={styles.menu}>
              <ReportReview
                reviewId={r.id}
                titleKey={r.titleKey}
                authorHandle={r.author.handle}
                title={reportTitle}
              />
            </span>
          )}
        </div>
        {r.body &&
          (r.isSpoiler ? (
            <SpoilerBody className={styles.body}>{r.body}</SpoilerBody>
          ) : (
            <p className={styles.body}>{r.body}</p>
          ))}
      </div>
    </article>
  );
}

const TMDB_MAX = 600;

export function TmdbReviewCard({ review: r }: { review: TmdbReview }) {
  const long = r.content.length > TMDB_MAX;
  const body = long ? `${r.content.slice(0, TMDB_MAX).replace(/\s+\S*$/, '')}…` : r.content;
  return (
    <article className={styles.rv} data-testid="tmdb-review-card">
      <span className={styles.tmdbAvatar} aria-hidden="true">
        {r.author.slice(0, 1).toUpperCase()}
      </span>
      <div className={styles.main}>
        <div className={styles.head}>
          <b>{r.author}</b>
          {r.rating !== null && (
            <span
              className={styles.stars}
              role="img"
              aria-label={starsLabel(Math.max(1, Math.round(r.rating)))}
            >
              {starsText(Math.max(1, Math.round(r.rating)))}
            </span>
          )}
          <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
          <span className={styles.tmdbSrc}>
            <span className={styles.tmdbMark}>TMDB</span> review
          </span>
        </div>
        <p className={styles.body}>{body}</p>
        {long && (
          <a className="link" href={r.url} target="_blank" rel="noopener noreferrer">
            Read the full review on TMDB
          </a>
        )}
      </div>
    </article>
  );
}
