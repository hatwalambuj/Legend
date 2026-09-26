'use client';
/**
 * Browse toolbar (DESIGN §7.1/§7.2): search field (mobile), type filter (All/Movies/Shows), sort select,
 * result count. State lives in the URL (?type=&sort=) so every view is shareable (A2-AC3).
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { BROWSE_SORT_OPTIONS } from '@/lib/catalog-order';
import type { SortKey, TypeFilter } from '@/lib/types';
import { Icon } from './Icon';
import { listHref, TYPE_OPTIONS } from './lib/params';
import styles from './BrowseToolbar.module.css';

export function TypeFilterControl({
  value,
  onChange,
  disabled,
}: {
  value: TypeFilter;
  onChange: (v: TypeFilter) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`seg ${styles.seg}`} role="group" aria-label="Type" data-testid="type-filter">
      {TYPE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          data-value={o.value}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SortSelect({
  value,
  onChange,
  id = 'sort-select',
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
  id?: string;
}) {
  return (
    <span className={`select ${styles.select}`}>
      <label htmlFor={id} className="sr-only">
        Sort by
      </label>
      <select
        id={id}
        data-testid="sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
      >
        {BROWSE_SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function BrowseToolbar({
  base,
  type,
  sort,
  total,
  headingId,
  showSearch = true,
}: {
  base: string;
  type: TypeFilter;
  sort: SortKey;
  total: number | undefined;
  headingId: string;
  showSearch?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const nav = (o: { type: TypeFilter; sort: SortKey }) =>
    start(() => router.push(listHref(base, o), { scroll: false }));

  return (
    <div className={styles.toolbar} aria-label="Sort and filter" role="region" aria-busy={pending}>
      {showSearch && (
        <form action="/search" method="get" role="search" className={styles.mSearch}>
          <label htmlFor={`${headingId}-q`} className="sr-only">
            Search titles
          </label>
          <Icon name="search" size={16} className={styles.searchIcon} />
          <input
            id={`${headingId}-q`}
            type="search"
            name="q"
            placeholder="Search 6.5+ movies & shows"
            autoComplete="off"
            data-testid="search-input"
          />
        </form>
      )}
      <TypeFilterControl value={type} onChange={(t) => nav({ type: t, sort })} />
      <SortSelect value={sort} onChange={(s) => nav({ type, sort: s })} />
      <span className={styles.count} aria-live="polite">
        {pending
          ? 'Loading…'
          : total !== undefined
            ? `${total} title${total === 1 ? '' : 's'} · 6.5+ only`
            : '6.5+ only'}
        {!pending && sort.startsWith('rating') && (
          <span className={styles.hint}> · Ties broken by vote count</span>
        )}
      </span>
    </div>
  );
}
