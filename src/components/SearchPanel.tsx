'use client';
/**
 * Search view (DESIGN §7.3, mobile Search tab): auto-focused field, search-as-you-type via the URL
 * (?q=, debounced, server-rendered results), recent searches kept locally.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { TypeFilter } from '@/lib/types';
import { Icon } from './Icon';
import styles from './SearchPanel.module.css';

const KEY = 'stubbed:recent-searches';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function remember(q: string) {
  try {
    const next = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function searchHref(q: string, type: TypeFilter): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (type !== 'all') p.set('type', type);
  const s = p.toString();
  return s ? `/search?${s}` : '/search';
}

export function SearchPanel({ q: initial, type }: { q: string; type: TypeFilter }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [recent, setRecent] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    if (initial.trim()) remember(initial.trim());
  }, [initial]);

  const go = (v: string, replace = true) =>
    start(() =>
      replace
        ? router.replace(searchHref(v, type), { scroll: false })
        : router.push(searchHref(v, type), { scroll: false }),
    );

  return (
    <div className={styles.panel}>
      <form
        role="search"
        action="/search"
        method="get"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          go(q, false);
        }}
      >
        <label htmlFor="search-q" className="sr-only">
          Search titles
        </label>
        <Icon name="search" size={18} className={styles.icon} />
        <input
          id="search-q"
          name="q"
          type="search"
          value={q}
          autoFocus
          autoComplete="off"
          placeholder="Search 6.5+ movies & shows"
          data-testid="search-input"
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => go(v), 300);
          }}
        />
        {type !== 'all' && <input type="hidden" name="type" value={type} />}
        <span className={styles.status} aria-live="polite">
          {pending ? 'Searching…' : ''}
        </span>
      </form>
      {!initial.trim() && recent.length > 0 && (
        <div className={styles.recent}>
          <h2 className="eyebrow">Recent searches</h2>
          <ul>
            {recent.map((r) => (
              <li key={r}>
                <Link href={searchHref(r, type)} className="chip">
                  {r}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
