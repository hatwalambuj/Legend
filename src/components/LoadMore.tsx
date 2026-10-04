'use client';
/**
 * Cursor "Load more" (ADR-003): appends the next pages below the server-rendered grid. Without JS the
 * button is a link to the next page URL.
 */
import { useState } from 'react';
import { api } from '@/lib/api-client';
import type { SortKey, TitleSummary, TypeFilter } from '@/lib/types';
import { TicketGrid } from './TicketGrid';
import styles from './LoadMore.module.css';

export function LoadMore({
  type,
  sort,
  cursor: initialCursor,
  fallbackHref,
  region,
  provider,
}: {
  type: TypeFilter;
  sort: SortKey;
  /** ADR-013 C-01/C-02: the region the server page used (echoed), resent so "Load more" keeps hints. */
  region?: string;
  provider?: number | null;
  cursor: string | null;
  fallbackHref: string | null;
}) {
  const [items, setItems] = useState<TitleSummary[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [announce, setAnnounce] = useState('');

  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(false);
    try {
      const page = await api.catalog({
        type,
        sort,
        cursor,
        limit: 20,
        ...(region ? { region } : {}),
        ...(region && provider ? { provider } : {}),
      });
      setItems((xs) => {
        const seen = new Set(xs.map((x) => x.key));
        return [...xs, ...page.items.filter((x) => !seen.has(x.key))];
      });
      setCursor(page.nextCursor);
      setAnnounce(`${page.items.length} more titles loaded`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {items.length > 0 && <TicketGrid titles={items} label="More titles" />}
      <div className={styles.row}>
        <span className="sr-only" aria-live="polite">
          {announce}
        </span>
        {error && (
          <p className={styles.error} role="alert">
            The projector jammed. We couldn&apos;t load titles.
          </p>
        )}
        {cursor ? (
          <a
            href={fallbackHref ?? '#'}
            className="btn btn--ghost"
            data-testid="load-more"
            aria-disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void more();
            }}
          >
            {busy ? 'Loading…' : error ? 'Try again' : 'Load more'}
          </a>
        ) : (
          items.length > 0 && <p className={styles.end}>That&apos;s everything rated 6.5+.</p>
        )}
      </div>
    </>
  );
}
