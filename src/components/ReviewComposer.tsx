'use client';
/**
 * Review composer (DESIGN §7.5, D1): required half-star rating, optional text (≤ 5,000), spoiler switch.
 * Saves to Stubbed only — there is no option to post anywhere else (ADR-008).
 */
import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import type { Review } from '@/lib/types';
import { useApp, type StubTarget } from '@/hooks/useApp';
import { Icon } from './Icon';
import { StarInput } from './StarInput';
import styles from './Reviews.module.css';

const MAX = 5000;

export function ReviewComposer({
  target,
  existing,
  onSaved,
}: {
  target: StubTarget;
  existing: Review | null;
  onSaved: (r: Review) => void;
}) {
  const app = useApp();
  const uid = useId();
  const [rating, setRating] = useState(existing?.rating10 ?? 0);
  const [body, setBody] = useState(existing?.body ?? '');
  const [spoiler, setSpoiler] = useState(existing?.isSpoiler ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError('Pick a star rating first — half stars are fine.');
      document.getElementById(`${uid}-stars`)?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.upsertReview({
        mediaType: target.mediaType,
        tmdbId: target.tmdbId,
        rating10: rating,
        body: body.trim(),
        isSpoiler: spoiler,
      });
      onSaved(res.review);
      if (res.suggestStub) {
        app.toast({
          message: (
            <>
              Review saved. <b>Add a stub too?</b>
            </>
          ),
          action: { label: 'Add stub', onClick: () => void app.stub(target) },
        });
      } else app.toast({ message: res.created ? 'Review posted' : 'Review updated' });
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae?.code === 'unauthenticated') app.openAuth({ kind: 'review', titleKey: target.key });
      else if (ae?.code === 'rate_limited') setError(ERROR_COPY.rate_limited_review);
      else if (ae?.code === 'validation_failed')
        setError(Object.values(ae.fields ?? {})[0] ?? ae.message);
      else if (ae?.code === 'not_implemented')
        setError("Reviews aren't switched on yet. Try again in a bit.");
      else setError("Couldn't save your review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.composer}
      id="review-composer"
      data-testid="review-composer"
      onSubmit={submit}
      noValidate
      aria-labelledby={`${uid}-h`}
    >
      <div className={styles.composerTop}>
        <strong id={`${uid}-h`}>{existing ? 'Your review' : 'Write a review'}</strong>
        <div id={`${uid}-stars`}>
          <StarInput
            value={rating}
            onChange={(v) => {
              setRating(v);
              setError(null);
            }}
            invalid={Boolean(error && !rating)}
            describedBy={error ? `${uid}-err` : undefined}
          />
        </div>
      </div>
      <label className="sr-only" htmlFor={`${uid}-body`}>
        Review text (optional)
      </label>
      <textarea
        id={`${uid}-body`}
        className={styles.textarea}
        maxLength={MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did it do to you? (optional)"
        aria-describedby={`${uid}-count`}
      />
      <div className={styles.composerRow}>
        <label className={styles.switch}>
          <input
            type="checkbox"
            role="switch"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
          />
          Contains spoilers
        </label>
        <span id={`${uid}-count`} className={`counter ${styles.count}`}>
          {body.length.toLocaleString('en-US')} / 5,000
        </span>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
          {existing ? 'Update review' : 'Post review'}
        </button>
      </div>
      <p id={`${uid}-err`} className={styles.error} role="alert">
        {error && (
          <>
            <Icon name="alert" size={14} />
            {error}
          </>
        )}
      </p>
      <p className={styles.note}>Reviews are saved to Stubbed only.</p>
    </form>
  );
}
