/** Server-rendered browse block: toolbar + first page grid + cursor "Load more" + empty state. */
import Link from 'next/link';
import { browseHref } from '@/lib/routes';
import type { Page, SortKey, TitleSummary, TypeFilter } from '@/lib/types';
import { BrowseToolbar } from './BrowseToolbar';
import { listHref } from './lib/params';
import { EmptyState } from './EmptyState';
import { LoadMore } from './LoadMore';
import { TicketGrid } from './TicketGrid';

export function BrowseSection({
  base,
  type,
  sort,
  page,
  headingId,
  failed = false,
}: {
  base: string;
  type: TypeFilter;
  sort: SortKey;
  page: Page<TitleSummary>;
  headingId: string;
  failed?: boolean;
}) {
  return (
    <>
      <BrowseToolbar base={base} type={type} sort={sort} total={page.total} headingId={headingId} />
      {failed ? (
        <div style={{ padding: '24px 0' }}>
          <EmptyState
            title="The projector jammed"
            action={
              <Link className="btn btn--ghost" href={listHref(base, { type, sort })}>
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
            key={`${type}-${sort}`}
            type={type}
            sort={sort}
            cursor={page.nextCursor}
            fallbackHref={
              page.nextCursor ? browseHref({ type, sort, cursor: page.nextCursor }) : null
            }
          />
        </>
      )}
    </>
  );
}
