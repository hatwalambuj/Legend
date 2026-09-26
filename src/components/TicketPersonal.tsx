'use client';
/** Personal-state leaves of a ticket (client islands): stamp, watchlist glyph, hero count pill. */
import { useEffect, useRef } from 'react';
import type { TitleKey } from '@/lib/types';
import { useApp, useTitleState } from '@/hooks/useApp';
import { Icon } from './Icon';
import styles from './Ticket.module.css';

/** "N× STUBBED" paper stamp on the poster; lands with a snap after a stub (DESIGN §5.1). */
export function StubStamp({ titleKey }: { titleKey: TitleKey }) {
  const state = useTitleState(titleKey);
  const { lastStub } = useApp();
  const ref = useRef<HTMLSpanElement>(null);
  const n = state?.stubCount ?? 0;

  useEffect(() => {
    const el = ref.current;
    if (!el || !lastStub || lastStub.key !== titleKey) return;
    el.classList.remove(styles.pop!);
    void el.offsetWidth;
    el.classList.add(styles.pop!);
  }, [lastStub, titleKey]);

  if (!n) return null;
  return (
    <span ref={ref} className={styles.stamp} aria-hidden="true">
      {n}× stubbed
    </span>
  );
}

export function WatchMark({ titleKey }: { titleKey: TitleKey }) {
  const state = useTitleState(titleKey);
  if (!state?.watchlisted) return null;
  return (
    <span className={styles.watchMark} title="On your watchlist">
      <Icon name="bookmark" size={12} />
      <span className="sr-only">On your watchlist</span>
    </span>
  );
}

/** Hero ticket: the big CTA owns the action, the stub only shows the count. */
export function HeroCount({ titleKey }: { titleKey: TitleKey }) {
  const state = useTitleState(titleKey);
  const n = state?.stubCount ?? 0;
  if (!n) return null;
  return (
    <span className={styles.heroCount} aria-hidden="true">
      <Icon name="check" size={13} />
      {n}×
    </span>
  );
}
