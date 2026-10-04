'use client';
/**
 * Header search (DESIGN §7.3): combobox with up to 6 compact results and "See all results".
 * ↑/↓ move, Enter opens, Esc closes. Without JS it is a plain GET form to /search.
 */
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatScore } from '@/lib/format';
import { titleHref } from '@/lib/routes';
import type { TitleSummary } from '@/lib/types';
import { Icon } from './Icon';
import { kindLabel } from './lib/display';
import { Poster } from './Poster';
import styles from './HeaderSearch.module.css';
import { BRAND_NAME } from '@/lib/brand';

export function HeaderSearch() {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState('');
  const [items, setItems] = useState<TitleSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'miss'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const allHref = `/search?q=${encodeURIComponent(q.trim())}`;
  const optionCount = q.trim() ? items.length + 1 : 0;

  function onChange(v: string) {
    setQ(v);
    setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) {
      setItems([]);
      setStatus('idle');
      setOpen(false);
      return;
    }
    setOpen(true);
    setStatus('loading');
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await api.search(v.trim(), 'all', 6);
        if (my !== seq.current) return;
        setItems(r.items);
        setStatus(r.items.length ? 'done' : 'miss');
      } catch {
        if (my === seq.current) setStatus('miss');
      }
    }, 180);
  }

  function go(i: number) {
    const t = items[i];
    setOpen(false);
    router.push(t ? titleHref(t) : allHref);
  }

  return (
    <form
      className={styles.search}
      role="search"
      aria-label="Quick search"
      action="/search"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim()) return;
        if (active >= 0) go(active);
        else {
          setOpen(false);
          router.push(allHref);
        }
      }}
    >
      <label htmlFor={`${uid}-q`} className="sr-only">
        Search titles
      </label>
      <Icon name="search" size={16} className={styles.icon} />
      <input
        id={`${uid}-q`}
        name="q"
        type="search"
        placeholder="Search 6.5+ movies & shows"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && optionCount > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => q.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (optionCount ? (a + 1) % optionCount : -1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (optionCount ? (a <= 0 ? optionCount - 1 : a - 1) : -1));
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        className={styles.list}
        hidden={!open || optionCount === 0}
      >
        {items.map((t, i) => (
          <li
            key={t.key}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={active === i}
            className={styles.opt}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(i)}
          >
            <Poster
              title={t.title}
              posterPath={t.posterPath}
              palette={t.palette}
              genreIds={t.genres.map((g) => g.id)}
              size="w92"
              bare
              className={styles.thumb}
            />
            <span className={styles.meta}>
              <b>{t.title}</b>
              <span>
                {t.year} · {kindLabel(t.mediaType)}
              </span>
            </span>
            <span className={styles.score}>
              {formatScore(t.voteAverage)}
              <small>TMDB</small>
            </span>
          </li>
        ))}
        {status === 'miss' && (
          <li className={styles.miss} role="presentation">
            Not in {BRAND_NAME} — we only list titles rated 6.5+.
          </li>
        )}
        {status === 'loading' && items.length === 0 && (
          <li className={styles.miss} role="presentation">
            Searching…
          </li>
        )}
        <li
          id={`${uid}-opt-${items.length}`}
          role="option"
          aria-selected={active === items.length}
          className={`${styles.opt} ${styles.all}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(items.length)}
        >
          See all results for “{q.trim()}”
        </li>
      </ul>
    </form>
  );
}
