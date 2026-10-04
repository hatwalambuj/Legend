'use client';
/**
 * Title-detail action row (DESIGN §7.4): [Stub it / Stub again] (primary, lg), [⋯] details sheet,
 * [Watchlist] toggle, and the live stubbed line ("2× STUBBED · Last stub Sep 12, 2026").
 */
import { useEffect, useRef } from 'react';
import { useApp, useTitleState, type StubTarget } from '@/hooks/useApp';
import { DEGRADED_DESC_ID } from './DegradedBanner';
import { Icon } from './Icon';
import { formatDate, starsLabel, starsText } from './lib/display';
import { ShareButton, type ShareTitle } from './ShareButton';
import styles from './TitleActions.module.css';

/** `paused` (degraded === 'catalog', ADR-011 §4): CTAs stay focusable but aria-disabled and inert. */
export function TitleActions({
  target,
  share,
  paused = false,
}: {
  target: StubTarget;
  /** ADR-013 C-07: the Share button (works signed out). */
  share?: ShareTitle;
  paused?: boolean;
}) {
  const app = useApp();
  const state = useTitleState(target.key);
  const n = state?.stubCount ?? 0;
  const watchlisted = state?.watchlisted ?? false;
  const pillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = pillRef.current;
    if (!el || app.lastStub?.key !== target.key) return;
    el.classList.remove(styles.pop!);
    void el.offsetWidth;
    el.classList.add(styles.pop!);
  }, [app.lastStub, target.key]);

  const pausedProps = paused
    ? { 'aria-disabled': true as const, 'aria-describedby': DEGRADED_DESC_ID }
    : {};

  return (
    <>
      <div className={styles.actions}>
        <button
          type="button"
          className={`btn btn--primary btn--lg ${styles.cta}`}
          data-testid="stub-button"
          data-count={n}
          {...pausedProps}
          onClick={(e) => {
            if (!paused) void app.stub(target, { source: e.currentTarget });
          }}
        >
          <Icon name="ticket" size={20} />
          <span>{n ? 'Stub again' : 'Stub it'}</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--lg btn--icon"
          aria-label="Stub with date, place and note"
          {...pausedProps}
          onClick={() => {
            if (!paused) app.openStubSheet(target);
          }}
          data-testid="stub-details"
        >
          <Icon name="more" size={20} />
        </button>
        <button
          type="button"
          className={`btn btn--ghost btn--lg ${styles.wl}`}
          aria-pressed={watchlisted}
          {...pausedProps}
          onClick={() => {
            if (!paused) void app.toggleWatchlist(target);
          }}
          data-testid="watchlist-button"
        >
          <Icon name={watchlisted ? 'check' : 'bookmark'} size={18} />
          <span>{watchlisted ? 'On watchlist' : 'Watchlist'}</span>
        </button>
        {share && (
          <ShareButton
            target={{ kind: 'title', title: share }}
            surface="title"
            label={`Share ${share.title}`}
            className="btn btn--ghost btn--lg"
          />
        )}
      </div>
      <p className={styles.line} aria-live="polite" data-testid="stub-count" data-count={n}>
        {n ? (
          <>
            <span ref={pillRef} className={styles.n}>
              {n}× STUBBED
            </span>
            {state?.lastWatchedOn && <span>Last stub {formatDate(state.lastWatchedOn)}</span>}
          </>
        ) : (
          <span>Not stubbed yet. One tap when you&apos;ve watched it.</span>
        )}
      </p>
      {state?.myReview && (
        <p className={styles.line} data-testid="my-rating">
          You rated{' '}
          <span role="img" aria-label={starsLabel(state.myReview.rating10)}>
            {starsText(state.myReview.rating10)}
          </span>
        </p>
      )}
    </>
  );
}
