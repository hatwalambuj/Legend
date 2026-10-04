/** Server-rendered browse block: toolbar + first page grid + cursor "Load more" + empty state. */
import Link from 'next/link';
import { browseHref } from '@/lib/routes';
import type { Page, SortKey, TitleSummary, TypeFilter, WatchProviderChip } from '@/lib/types';
import { BrowseToolbar } from './BrowseToolbar';
import { listHref } from './lib/params';
import { EmptyState } from './EmptyState';
import { LoadMore } from './LoadMore';
import { ProviderFilter } from './ProviderFilter';
import { TicketGrid } from './TicketGrid';

export function BrowseSection({
  base,
  type,
  sort,
  page,
  headingId,
  failed = false,
  region,
  provider = null,
  chips = [],
}: {
  base: string;
  type: TypeFilter;
  sort: SortKey;
  page: Page<TitleSummary> & { region?: string };
  headingId: string;
  failed?: boolean;
  /** ADR-013 C-01: the region the page asked for (stub logos); resent by "Load more". */
  region?: string;
  /** ADR-013 C-02: active provider filter + its chips (browse only). */
  provider?: number | null;
  chips?: WatchProviderChip[];
}) {
  const echoed = page.region ?? region;
  return (
    <>
      <BrowseToolbar
        base={base}
        type={type}
        sort={sort}
        total={page.total}
        headingId={headingId}
        provider={provider}
      >
        {chips.length > 0 && (
          <ProviderFilter base={base} type={type} sort={sort} provider={provider} chips={chips} />
        )}
      </BrowseToolbar>
      {failed ? (
        <div style={{ padding: '24px 0' }}>
          <EmptyState
            title="The projector jammed"
            action={
              <Link className="btn btn--ghost" href={listHref(base, { type, sort, provider })}>
                Try again
              </Link>
            }
          >
            We couldn&apos;t load titles.
          </EmptyState>
        </div>
      ) : page.items.length === 0 ? (
        <div style={{ padding: '24px 0' }}>
          <EmptyState
            title="Nothing here yet"
            action={
              <Link className="btn btn--ghost" href={base}>
                Reset filters
              </Link>
            }
          >
            Try All or a different sort.
          </EmptyState>
        </div>
      ) : (
        <>
          <TicketGrid titles={page.items} label="Titles" />
          <LoadMore
            key={`${type}-${sort}-${provider ?? ''}`}
            type={type}
            sort={sort}
            region={echoed}
            provider={provider}
            cursor={page.nextCursor}
            fallbackHref={
              page.nextCursor ? browseHref({ type, sort, provider, cursor: page.nextCursor }) : null
            }
          />
        </>
      )}
    </>
  );
}
