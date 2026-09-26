/** Server-rendered type filter as links (search page): All · Movies · Shows. */
import Link from 'next/link';
import type { TypeFilter } from '@/lib/types';
import { TYPE_OPTIONS } from './lib/params';

function href(q: string, type: TypeFilter) {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (type !== 'all') p.set('type', type);
  const s = p.toString();
  return s ? `/search?${s}` : '/search';
}

export function TypeFilterLinks({ q, type }: { q: string; type: TypeFilter }) {
  return (
    <nav
      className="seg"
      aria-label="Filter by type"
      data-testid="type-filter"
      style={{ margin: '16px 0 8px' }}
    >
      {TYPE_OPTIONS.map((o) => (
        <Link
          key={o.value}
          href={href(q, o.value)}
          aria-current={type === o.value ? 'page' : undefined}
          scroll={false}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
