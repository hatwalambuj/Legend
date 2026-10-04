'use client';
/**
 * Mount with `key={view}` so switching views resets the form state.
 *
 * Sign in / sign up form (DESIGN §7.6, B1/B2). Shared by the auth sheet and the /signin, /signup pages.
 * Inline validation on blur, then live after the first error; server `fields` map onto inputs.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { Icon } from './Icon';
import { readShareRef } from './lib/share-ref';
import styles from './AuthForm.module.css';

export type AuthView = 'signin' | 'signup';
type Field = 'email' | 'password' | 'handle';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function validate(view: AuthView, f: Field, v: string): string | null {
  if (f === 'email') return EMAIL_RE.test(v.trim()) ? null : 'Enter a valid email';
  if (f === 'password') {
    if (view === 'signin') return v ? null : 'Enter your password';
    if (v.length < 8) return '8+ characters';
    if (v.length > 72) return 'At most 72 characters';
    return null;
  }
  return HANDLE_RE.test(v.trim().toLowerCase()) ? null : '3–20 characters: a–z, 0–9 and _';
}

export function AuthForm({
  view,
  onViewChange,
  onSuccess,
  next,
  headingId,
  headingLevel = 'h2',
}: {
  view: AuthView;
  onViewChange: (v: AuthView) => void;
  onSuccess: (s: Session) => void;
  next?: string;
  headingId: string;
  headingLevel?: 'h1' | 'h2';
}) {
  const { mode } = useApp();
  const uid = useId();
  const [values, setValues] = useState({ email: '', password: '', handle: '' });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [live, setLive] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handleNote, setHandleNote] = useState<{
    handle: string;
    ok: boolean;
    text: string;
  } | null>(null);
  const [magic, setMagic] = useState<{ sent: boolean; devLink?: string } | null>(null);
  // ADR-010 ID-1: live sign-up with "Confirm email" ON answers 202 { session: null, confirmEmail: true }.
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const fields: Field[] =
    view === 'signup' ? ['email', 'password', 'handle'] : ['email', 'password'];

  // Live handle availability (debounced).
  useEffect(() => {
    if (view !== 'signup') return;
    const h = values.handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .handleAvailable(h)
        .then((r) => {
          if (!alive) return;
          setHandleNote(
            r.available
              ? { handle: h, ok: true, text: `@${h} is free` }
              : { handle: h, ok: false, text: r.reason ?? `@${h} is taken` },
          );
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [values.handle, view]);

  const set = (f: Field, v: string) => {
    setValues((s) => ({ ...s, [f]: v }));
    if (live || errors[f]) setErrors((e) => ({ ...e, [f]: validate(view, f, v) ?? undefined }));
  };
  const blur = (f: Field) => {
    const msg = validate(view, f, values[f]);
    if (values[f] || live) setErrors((e) => ({ ...e, [f]: msg ?? undefined }));
    if (msg) setLive(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errs: Partial<Record<Field, string>> = {};
    for (const f of fields) {
      const m = validate(view, f, values[f]);
      if (m) errs[f] = m;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setLive(true);
      return;
    }
    setBusy(true);
    try {
      const res =
        view === 'signup'
          ? await api.signUp({
              email: values.email.trim(),
              password: values.password,
              handle: values.handle.trim().toLowerCase(),
              ...(readShareRef() ? { ref: 'share' as const } : {}),
            })
          : await api.signIn({ email: values.email.trim(), password: values.password });
      if (res.session) onSuccess(res.session);
      else setConfirmFor(values.email.trim());
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      if (ae?.code === 'invalid_credentials') setFormError(ERROR_COPY.invalid_credentials);
      else if (ae?.code === 'email_taken') setErrors({ email: ERROR_COPY.email_taken });
      else if (ae?.code === 'handle_taken') setErrors({ handle: `@${values.handle} is taken` });
      else if (ae?.code === 'validation_failed' && ae.fields) {
        setErrors(ae.fields as Partial<Record<Field, string>>);
        setLive(true);
      } else if (ae?.code === 'rate_limited') setFormError('Too many tries. Wait a minute.');
      else if (ae?.code === 'not_implemented')
        setFormError("Accounts aren't switched on yet. Try again in a bit.");
      else setFormError(ERROR_COPY.internal);
    } finally {
      setBusy(false);
    }
  }

  async function sendMagic() {
    const msg = validate(view, 'email', values.email);
    if (msg) {
      setErrors((e) => ({ ...e, email: msg }));
      setLive(true);
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await api.magicLink({ email: values.email.trim(), next });
      setMagic({ sent: true, devLink: r.devLink });
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      setFormError(
        ae?.code === 'not_implemented'
          ? "Magic links aren't switched on yet."
          : ae?.code === 'rate_limited'
            ? 'Too many links requested. Wait a minute.'
            : ERROR_COPY.internal,
      );
    } finally {
      setBusy(false);
    }
  }

  const H = headingLevel;
  const note =
    handleNote && handleNote.handle === values.handle.trim().toLowerCase() ? handleNote : null;
  const id = (f: string) => `${uid}-${f}`;
  const describe = (f: Field, extra?: string) =>
    [errors[f] ? id(`${f}-err`) : null, extra].filter(Boolean).join(' ') || undefined;

  if (confirmFor) {
    return (
      <div className={styles.form} data-testid="auth-confirm-email">
        <H id={headingId} className={styles.title}>
          Check your inbox
        </H>
        <p className={styles.sub} role="status">
          Check your inbox to finish signing up. We sent a link to{' '}
          <strong className="mono">{confirmFor}</strong>.
        </p>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => onViewChange('signin')}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate data-testid="auth-form">
      <H id={headingId} className={styles.title}>
        {view === 'signup' ? 'Get your first stub' : 'Welcome back'}
      </H>
      <p className={styles.sub}>
        {view === 'signup'
          ? 'Track every watch. Rewatches count too.'
          : 'Sign in to stub, review and keep your wallet.'}
      </p>

      {mode.isDemo && (
        <div className={styles.demo}>
          <p>Demo mode — accounts are stored on this server only.</p>
          {mode.demoAccounts.length > 0 && view === 'signin' && (
            <ul>
              {mode.demoAccounts.map((a) => (
                <li key={a.handle}>
                  <button
                    type="button"
                    className={styles.demoAcc}
                    onClick={() => {
                      setValues((s) => ({ ...s, email: a.email, password: a.password }));
                      setErrors({});
                    }}
                  >
                    Use @{a.handle}
                  </button>
                  <span className="mono">
                    {a.email} · {a.password}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={id('email')}>Email</label>
        <input
          ref={emailRef}
          id={id('email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          onBlur={() => blur('email')}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describe('email')}
          required
        />
        {errors.email && (
          <span id={id('email-err')} className="field-error">
            <Icon name="alert" size={14} />
            {errors.email}
            {errors.email === ERROR_COPY.email_taken && (
              <button type="button" className="text-btn" onClick={() => onViewChange('signin')}>
                Sign in
              </button>
            )}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor={id('password')}>Password</label>
        <div className={styles.pw}>
          <input
            id={id('password')}
            type={showPw ? 'text' : 'password'}
            name="password"
            autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
            value={values.password}
            onChange={(e) => set('password', e.target.value)}
            onFocus={() => setPwFocus(true)}
            onBlur={() => {
              setPwFocus(false);
              blur('password');
            }}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={describe('password', view === 'signup' ? id('pw-hint') : undefined)}
            required
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
        {view === 'signup' && (
          <span
            id={id('pw-hint')}
            className={`field-hint ${pwFocus || values.password ? '' : 'sr-only'}`}
          >
            8+ characters
          </span>
        )}
        {errors.password && (
          <span id={id('password-err')} className="field-error">
            <Icon name="alert" size={14} />
            {errors.password}
          </span>
        )}
      </div>

      {view === 'signup' && (
        <div className="field">
          <label htmlFor={id('handle')}>Handle</label>
          <div className={styles.handle}>
            <span aria-hidden="true">@</span>
            <input
              id={id('handle')}
              name="handle"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={values.handle}
              onChange={(e) => set('handle', e.target.value)}
              onBlur={() => blur('handle')}
              aria-invalid={errors.handle ? true : undefined}
              aria-describedby={describe('handle', id('handle-rule'))}
              required
            />
          </div>
          <span id={id('handle-rule')} className="field-hint" aria-live="polite">
            {note && !errors.handle ? (
              <span className={note.ok ? styles.ok : styles.bad}>{note.text}</span>
            ) : (
              '3–20 · a–z, 0–9, _'
            )}
          </span>
          {errors.handle && (
            <span id={id('handle-err')} className="field-error">
              <Icon name="alert" size={14} />
              {errors.handle}
            </span>
          )}
        </div>
      )}

      <div className={styles.formError} aria-live="assertive" role="alert">
        {formError && (
          <>
            <Icon name="alert" size={16} />
            {formError}
          </>
        )}
      </div>

      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
        {view === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      {view === 'signin' && (
        <button type="button" className={styles.forgot} onClick={sendMagic} disabled={busy}>
          Forgot password?
        </button>
      )}

      <div className={styles.or}>
        <span>or</span>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={sendMagic}
        disabled={busy}
      >
        Email me a magic link
      </button>
      {magic?.sent && (
        <p className={styles.magic} role="status">
          Check your inbox for a sign-in link.
          {magic.devLink && (
            <>
              {' '}
              Demo mode:{' '}
              <a className="link" href={magic.devLink}>
                open the magic link
              </a>
              .
            </>
          )}
        </p>
      )}

      <p className={styles.switch}>
        {view === 'signup' ? (
          <>
            Already stubbing?{' '}
            <button type="button" className="text-btn" onClick={() => onViewChange('signin')}>
              Sign in
            </button>
          </>
        ) : (
          <>
            New here?{' '}
            <button type="button" className="text-btn" onClick={() => onViewChange('signup')}>
              Create an account
            </button>
          </>
        )}
      </p>
    </form>
  );
}
