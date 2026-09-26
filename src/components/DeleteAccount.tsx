'use client';
/**
 * Settings → Delete account (GAP-06). An in-page, typed confirmation (no window.confirm): the button
 * stays disabled until the user types DELETE. Calls DELETE /api/me, then signs out locally and goes home.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import { useApp } from '@/hooks/useApp';
import styles from './DeleteAccount.module.css';

export const DELETE_WORD = 'DELETE';

export function DeleteAccount() {
  const { signOut } = useApp();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const armed = value.trim() === DELETE_WORD;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const cancel = () => {
    setOpen(false);
    setValue('');
    setError(null);
    // Return focus to the trigger once it is rendered again.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn--ghost ${styles.trigger}`}
        onClick={() => setOpen(true)}
        data-testid="delete-account"
      >
        Delete account…
      </button>
    );
  }

  return (
    <form
      className={styles.panel}
      aria-labelledby={`${uid}-h`}
      aria-describedby={`${uid}-d`}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) cancel();
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!armed || busy) return;
        setBusy(true);
        setError(null);
        try {
          await api.deleteAccount();
          await signOut({ remote: false, message: 'Your account and all its data are deleted.' });
        } catch (err) {
          setBusy(false);
          setError(
            err instanceof ApiError && err.code === 'unauthenticated'
              ? ERROR_COPY.unauthenticated
              : err instanceof ApiError && err.message
                ? err.message
                : ERROR_COPY.internal,
          );
        }
      }}
    >
      <h3 id={`${uid}-h`}>Delete your account?</h3>
      <p id={`${uid}-d`}>
        This erases your profile, every stub, rating, review and your watchlist. It can&apos;t be
        undone. Export your data first if you want to keep it.
      </p>
      <div className="field">
        <label htmlFor={`${uid}-in`}>Type {DELETE_WORD} to confirm</label>
        <input
          ref={inputRef}
          id={`${uid}-in`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-d ${uid}-err` : `${uid}-d`}
          data-testid="delete-account-input"
        />
        {error && (
          <span id={`${uid}-err`} className="field-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className={styles.row}>
        <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--danger"
          disabled={!armed || busy}
          aria-busy={busy || undefined}
          data-testid="delete-account-confirm"
        >
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}
