'use client';
/**
 * Settings → "Set a new password" (ADR-010 ID-2, M1-12). PUT /api/auth/password. The server requires a
 * sign-in in the last 10 minutes; on `reauth_required` we explain why and reopen the sign-in sheet.
 * The typed password is kept so the user can retry after signing in again. Other sessions stay valid.
 */
import { useId, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import { useApp } from '@/hooks/useApp';
import { Icon } from './Icon';
import styles from './SetPasswordForm.module.css';

function validate(v: string): string | null {
  if (v.length < 8) return '8+ characters';
  if (v.length > 72) return 'At most 72 characters';
  return null;
}

export function SetPasswordForm() {
  const app = useApp();
  const uid = useId();
  const [value, setValue] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    setReauth(false);
    setDone(false);
    const msg = validate(value);
    setFieldError(msg);
    if (msg) return;
    setBusy(true);
    try {
      await api.setPassword({ password: value });
      setValue('');
      setShowPw(false);
      setDone(true);
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae?.code === 'reauth_required') {
        setReauth(true);
        setFormError(ERROR_COPY.reauth_required);
        app.openAuth({ kind: 'signin' }, 'signin');
      } else if (ae?.code === 'validation_failed' && ae.fields?.password) {
        setFieldError(ae.fields.password);
      } else if (ae?.code === 'unauthenticated') {
        setFormError(ERROR_COPY.unauthenticated);
      } else if (ae?.code === 'rate_limited') {
        setFormError('Too many tries. Wait a few minutes.');
      } else if (ae?.code === 'not_implemented') {
        setFormError("That isn't switched on yet. Try again in a bit.");
      } else {
        setFormError(ERROR_COPY.internal);
      }
    } finally {
      setBusy(false);
    }
  }

  const id = (s: string) => `${uid}-${s}`;
  const describedBy = [id('hint'), fieldError ? id('err') : null].filter(Boolean).join(' ');

  return (
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-labelledby={id('h')}
      data-testid="set-password-form"
    >
      <h3 id={id('h')} className={styles.title}>
        Set a new password
      </h3>
      <div className="field">
        <label htmlFor={id('pw')}>New password</label>
        <div className={styles.pw}>
          <input
            id={id('pw')}
            type={showPw ? 'text' : 'password'}
            name="new-password"
            autoComplete="new-password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDone(false);
              if (fieldError) setFieldError(validate(e.target.value));
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedBy}
            required
            data-testid="set-password-input"
          />
          <button
            type="button"
            className={styles.eye}
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            aria-pressed={showPw}
          >
            <Icon name={showPw ? 'eye-off' : 'eye'} />
          </button>
        </div>
        <span id={id('hint')} className="field-hint">
          8–72 characters. You may be asked to sign in again first.
        </span>
        {fieldError && (
          <span id={id('err')} className="field-error">
            <Icon name="alert" size={14} />
            {fieldError}
          </span>
        )}
      </div>

      <div className={styles.msg} role="alert" aria-live="assertive">
        {formError && (
          <>
            <Icon name="alert" size={16} />
            <span>
              {formError}
              {reauth && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => app.openAuth({ kind: 'signin' }, 'signin')}
                  >
                    Sign in again
                  </button>
                </>
              )}
            </span>
          </>
        )}
      </div>
      <p className={styles.ok} role="status">
        {done && 'Password updated. Other devices stay signed in.'}
      </p>

      <button
        type="submit"
        className="btn btn--ghost"
        disabled={busy}
        aria-busy={busy || undefined}
        data-testid="set-password-submit"
      >
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
