'use client';
/**
 * Reviews on the title page (DESIGN §7.5): "On Stubbed · N" / "From TMDB · N", Newest / Highest rated,
 * composer (signed in) or "Sign in to review", own review pinned on top with Edit / Delete.
 */
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { Page, Review, ReviewSort, TmdbReview } from '@/lib/types';
import { useApp, useTitleState, type StubTarget } from '@/hooks/useApp';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import { ReviewCard, TmdbReviewCard } from './ReviewCard';
import { ReviewComposer } from './ReviewComposer';
import styles from './Reviews.module.css';

export function Reviews({
  target,
  initial,
  tmdbReviews,
  reviewCount,
}: {
  target: StubTarget;
  initial: Page<Review>;
  tmdbReviews: TmdbReview[];
  reviewCount: number;
}) {
  const app = useApp();
  const state = useTitleState(target.key);
  const mine = state?.myReview ?? null;
  const [src, setSrc] = useState<'stubbed' | 'tmdb'>('stubbed');
  const [sort, setSort] = useState<ReviewSort>('newest');
  const [list, setList] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [deletedId, setDeletedId] = useState<string | null>(null);

  const others = list.filter((r) => r.id !== mine?.id && r.id !== deletedId);
  const stubbedCount = Math.max(reviewCount, list.length);

  async function load(nextSort: ReviewSort, more = false) {
    setBusy(true);
    try {
      const page = await api.titleReviews(
        target.mediaType,
        target.tmdbId,
        nextSort,
        more ? cursor : null,
      );
      setList((xs) => (more ? [...xs, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch {
      app.toast({ message: "Couldn't load reviews. Try again." });
    } finally {
      setBusy(false);
    }
  }

  function saved(r: Review) {
    app.setTitleState(target.key, (s) => ({ ...s, myReview: r }));
  }

  async function remove(r: Review) {
    const ok = await app.confirm({
      title: 'Delete your review?',
      body: "This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteReview(r.id);
      app.setTitleState(target.key, (s) => ({ ...s, myReview: null }));
      setDeletedId(r.id);
      app.toast({ message: 'Review deleted' });
    } catch (e) {
      app.toast({
        message:
          e instanceof ApiError && e.code === 'not_implemented'
            ? "That isn't switched on yet. Try again in a bit."
            : "Couldn't delete your review. Try again.",
      });
    }
  }

  const composer = app.session ? (
    <ReviewComposer
      key={mine ? `${mine.id}-${mine.updatedAt}` : 'new'}
      target={target}
      existing={mine}
      onSaved={saved}
    />
  ) : (
    <div className={styles.composer} id="review-composer" data-testid="review-composer">
      <div className={styles.composerTop}>
        <strong>Sign in to review</strong>
      </div>
      <p className={styles.signinCopy}>Stars are enough — words optional.</p>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => app.openAuth({ kind: 'review', titleKey: target.key })}
      >
        Sign in to review
      </button>
    </div>
  );

  return (
    <section className={styles.reviews} aria-labelledby="reviews-h">
      <div className="sec-h" style={{ marginTop: 0 }}>
        <h2 id="reviews-h">Reviews</h2>
      </div>
      <div className={styles.tabs}>
        <div className="seg" role="group" aria-label="Review source">
          <button type="button" aria-pressed={src === 'stubbed'} onClick={() => setSrc('stubbed')}>
            On Stubbed · {stubbedCount}
          </button>
          <button type="button" aria-pressed={src === 'tmdb'} onClick={() => setSrc('tmdb')}>
            From TMDB · {tmdbReviews.length}
          </button>
        </div>
        {src === 'stubbed' && (
          <span className={`select ${styles.sort}`}>
            <label htmlFor="review-sort" className="sr-only">
              Sort reviews
            </label>
            <select
              id="review-sort"
              value={sort}
              onChange={(e) => {
                const v = e.target.value as ReviewSort;
                setSort(v);
                void load(v);
              }}
            >
              <option value="newest">Newest</option>
              <option value="highest">Highest rated</option>
            </select>
          </span>
        )}
      </div>

      {src === 'tmdb' ? (
        tmdbReviews.length ? (
          <div>
            {tmdbReviews.map((r) => (
              <TmdbReviewCard key={r.id} review={r} />
            ))}
            <p className={styles.tmdbFoot}>Reviews from TMDB community members. Read-only.</p>
          </div>
        ) : (
          <EmptyState title="No TMDB reviews">Nobody on TMDB has reviewed this yet.</EmptyState>
        )
      ) : (
        <div aria-busy={busy}>
          {composer}
          {mine && (
            <ReviewCard
              review={mine}
              mine
              menu={
                <span className={styles.ownMenu}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      const el = document.getElementById('review-composer');
                      el?.scrollIntoView({ block: 'center' });
                      el?.querySelector<HTMLElement>('textarea')?.focus();
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void remove(mine)}
                  >
                    Delete
                  </button>
                </span>
              }
            />
          )}
          {others.map((r) => (
            <ReviewCard key={r.id} review={r} reportTitle={`${target.title} (${target.year})`} />
          ))}
          {!mine && others.length === 0 && (
            <EmptyState
              title="No reviews yet"
              action={
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    if (!app.session) app.openAuth({ kind: 'review', titleKey: target.key });
                    else
                      document
                        .getElementById('review-composer')
                        ?.querySelector<HTMLElement>('[tabindex="0"]')
                        ?.focus();
                  }}
                >
                  <Icon name="star" size={16} />
                  Be the first to review
                </button>
              }
            >
              Be the first to review {target.title}. Stars are enough — words optional.
            </EmptyState>
          )}
          {cursor && (
            <div className={styles.more}>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void load(sort, true)}
              >
                {busy ? 'Loading…' : 'More reviews'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
