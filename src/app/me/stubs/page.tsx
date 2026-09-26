import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { DiaryList } from '@/components/Diary';
import { EmptyState } from '@/components/EmptyState';
import { first, type SearchParams } from '@/components/lib/params';
import { safe } from '@/components/lib/safe';
import { NEUTRAL_PALETTE, paletteOrDefault } from '@/lib/images';
import type { TypeFilter } from '@/lib/types';
import { dal } from '@/server/dal';

// OWNER: Frontend. My stubs / watch history (DESIGN §7.8). Private: reads the session.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My stubs', robots: { index: false } };

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'Shows' },
];

export default async function MyStubsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await dal.getSession();
  if (!session) redirect('/signin?next=/me/stubs');
  const sp = await searchParams;
  const t = first(sp.type);
  const type: TypeFilter = t === 'movie' || t === 'tv' ? t : 'all';
  const cursor = first(sp.cursor) ?? null;
  const handle = session.user.handle;
  const [diary, profile] = await Promise.all([
    safe(
      dal.listDiary(handle, { type, cursor, limit: 50 }),
      { items: [], nextCursor: null },
      'listDiary',
    ),
    safe(dal.getProfile(handle), null, 'getProfile'),
  ]);
  const count =
    type === 'all' && !cursor && profile ? profile.stats.totalStubs : diary.items.length;
  const latest = diary.items[0]?.title;
  const palette = latest
    ? paletteOrDefault(
        latest.palette,
        latest.genres.map((g) => g.id),
      )
    : NEUTRAL_PALETTE;
  const href = (v: TypeFilter) => (v === 'all' ? '/me/stubs' : `/me/stubs?type=${v}`);

  return (
    <>
      <AdaptiveBackground palette={palette} />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">@{handle} · diary</div>
          <h1>My stubs</h1>
          <p>Every watch, newest first. Edit a date or delete a stub from its menu.</p>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <nav className="seg" aria-label="Filter by type" data-testid="type-filter">
            {TYPES.map((o) => (
              <Link
                key={o.value}
                href={href(o.value)}
                aria-current={type === o.value ? 'page' : undefined}
              >
                {o.label}
              </Link>
            ))}
          </nav>
          <span
            className="mono"
            style={{ fontSize: 12, letterSpacing: '.06em', color: 'var(--fg-2)' }}
          >
            {count} STUB{count === 1 ? '' : 'S'}
          </span>
          <Link
            href="/me/settings#export"
            className="link"
            style={{ marginLeft: 'auto', fontSize: 14 }}
          >
            Export my stubs
          </Link>
        </div>
        {diary.items.length ? (
          <DiaryList entries={diary.items} editable />
        ) : (
          <EmptyState
            title="No stubs yet"
            action={
              <Link href="/browse" className="btn btn--primary">
                Browse titles
              </Link>
            }
          >
            Your diary fills up one watch at a time.
          </EmptyState>
        )}
        {diary.nextCursor && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
            <Link
              className="btn btn--ghost"
              href={`/me/stubs?${new URLSearchParams({ ...(type !== 'all' ? { type } : {}), cursor: diary.nextCursor })}`}
            >
              Older stubs
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
