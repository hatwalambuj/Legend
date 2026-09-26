'use client';
/**
 * /signin and /signup fallbacks (DESIGN §7.6): the same form as the sheet, centred on the default tint.
 * Supports ?next= (same-origin only, safeNext) and ?action=stub|watchlist|review to replay after auth.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { parseTitleSlug, safeNext } from '@/lib/routes';
import { toTitleKey } from '@/lib/keys';
import { useApp, type PendingAction } from '@/hooks/useApp';
import { AuthForm, type AuthView } from './AuthForm';
import styles from './AuthPage.module.css';

function pendingFrom(action: string | null, next: string): PendingAction | null {
  const m = /^\/title\/(movie|tv)\/([^/?#]+)/.exec(next);
  const parsed = m?.[2] ? parseTitleSlug(m[2]) : null;
  if (!m || !parsed) return null;
  const mediaType = m[1] as 'movie' | 'tv';
  const key = toTitleKey(mediaType, parsed.tmdbId);
  const name = parsed.slug
    ? parsed.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'this title';
  const target = { key, mediaType, tmdbId: parsed.tmdbId, title: name, year: 0 };
  if (action === 'stub') return { kind: 'stub', target };
  if (action === 'watchlist') return { kind: 'watchlist', target };
  if (action === 'review') return { kind: 'review', titleKey: key };
  return null;
}

export function AuthPage({ initialView }: { initialView: AuthView }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { session, sessionReady, onAuthed } = useApp();
  const [view, setView] = useState<AuthView>(initialView);
  const next = safeNext(sp.get('next'));
  const action = sp.get('action');
  const callbackError = sp.get('error') === 'callback';

  useEffect(() => {
    if (sessionReady && session) router.replace(next);
  }, [sessionReady, session, next, router]);

  return (
    <div className={styles.page}>
      <div className={styles.card} data-testid="auth-page">
        {callbackError && (
          <p className={styles.err} role="alert">
            That sign-in link didn&apos;t work. It may have expired — request a new one.
          </p>
        )}
        <AuthForm
          key={view}
          view={view}
          onViewChange={(v) => {
            setView(v);
            const q = new URLSearchParams(sp.toString());
            router.replace(`/${v}${q.toString() ? `?${q}` : ''}`, { scroll: false });
          }}
          next={next}
          headingId="auth-page-h"
          headingLevel="h1"
          onSuccess={(s) => {
            onAuthed(s, pendingFrom(action, next));
            router.replace(next);
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}
