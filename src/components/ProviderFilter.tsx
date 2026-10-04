/**
 * Browse "On {Service}" chips (ADR-013 C-02, DESIGN §7.4.2): plain links, so they work without JS and the
 * URL stays shareable. `?provider=` keeps type/sort and drops the cursor. Zero-count chips never render;
 * with no chips the row is hidden.
 */
import Link from 'next/link';
import type { SortKey, TypeFilter, WatchProviderChip } from '@/lib/types';
import { listHref } from './lib/params';
import { ProviderLogo } from './ProviderTile';
import styles from './ProviderFilter.module.css';

export function ProviderFilter({
  base,
  type,
  sort,
  provider,
  chips,
}: {
  base: string;
  type: TypeFilter;
  sort: SortKey;
  provider: number | null;
  chips: WatchProviderChip[];
}) {
  const shown = chips.filter((c) => c.count >= 1);
  if (shown.length === 0) return null;
  const chip = (id: number | null, label: string, logo?: WatchProviderChip) => {
    const active = provider === id;
    return (
      <li key={id ?? 'all'}>
        <Link
          className={styles.chip}
          href={listHref(base, { type, sort, provider: id })}
          aria-current={active ? 'true' : undefined}
          data-testid={id === null ? 'provider-chip-all' : `provider-chip-${id}`}
          scroll={false}
        >
          {logo && (
            <ProviderLogo
              name={logo.name}
              logoPath={logo.logoPath}
              monogram={logo.monogram}
              tile={null}
              size={18}
              className={styles.logo}
            />
          )}
          {label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Filter by streaming service" data-testid="provider-filter">
      <ul className={styles.row}>
        {chip(null, 'All services')}
        {shown.map((c) => chip(c.providerId, `On ${c.name}`, c))}
      </ul>
    </nav>
  );
}
