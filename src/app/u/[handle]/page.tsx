import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { Avatar } from '@/components/Avatar';
import { DiaryList } from '@/components/Diary';
import { EmptyState } from '@/components/EmptyState';
import { first, type SearchParams } from '@/components/lib/params';
import { safe } from '@/components/lib/safe';
import { EditProfile, OwnerOnly, OwnerSwitch, OwnerWatchlist } from '@/components/Owner';
import { ReviewCard } from '@/components/ReviewCard';
import { WalletGrid } from '@/components/WalletStub';
import { NEUTRAL_PALETTE } from '@/lib/images';
import { profileHref, titleHref } from '@/lib/routes';
import { dal } from '@/server/dal';
import { today } from '@/server/env';
import styles from './profile.module.css';

// OWNER: Frontend. Profile / stub wallet (DESIGN §7.7). Tabs via ?tab= (server-rendered panels).
export const dynamic = 'force-dynamic';

type Tab = 'wallet' | 'diary' | 'reviews' | 'watchlist';
const TABS: Tab[] = ['wallet', 'diary', 'reviews', 'watchlist'];
const EMPTY = { items: [], nextCursor: null };

const load = cache((handle: string) => dal.getProfile(handle.toLowerCase()));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const p = await load(handle).catch(() => null);
  if (!p) return { title: "No one's holding that ticket" };
  return {
    title: `${p.profile.displayName} (@${p.profile.handle})`,
    description: `${p.stats.totalStubs} stubs on Stubbed. ${p.profile.bio}`.trim(),
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { handle } = await params;
  const sp = await searchParams;
  const data = await load(handle);
  if (!data) notFound();
  const { profile, stats } = data;
  const tabParam = first(sp.tab) as Tab | undefined;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'wallet';
  const cursor = first(sp.cursor) ?? null;
  const base = profileHref(profile.handle);
  const since = profile.createdAt.slice(0, 4);
  const year = today().slice(0, 4);

  const [wallet, diary, reviews] = await Promise.all([
    tab === 'wallet'
      ? safe(dal.listWallet(profile.handle, { cursor }), EMPTY, 'listWallet')
      : EMPTY,
    tab === 'diary' ? safe(dal.listDiary(profile.handle, { cursor }), EMPTY, 'listDiary') : EMPTY,
    tab === 'reviews'
      ? safe(dal.listProfileReviews(profile.handle, { cursor }), EMPTY, 'listProfileReviews')
      : EMPTY,
  ]);

  const tabLink = (t: Tab, label: string) => (
    <Link
      href={t === 'wallet' ? base : `${base}?tab=${t}`}
      aria-current={tab === t ? 'page' : undefined}
      scroll={false}
    >
      {label}
    </Link>
  );
  const nextHref = (c: string | null) =>
    c ? `${base}?tab=${tab}&cursor=${encodeURIComponent(c)}` : null;
  const next =
    tab === 'wallet'
      ? nextHref(wallet.nextCursor)
      : tab === 'diary'
        ? nextHref(diary.nextCursor)
        : tab === 'reviews'
          ? nextHref(reviews.nextCursor)
          : null;

  return (
    <>
      <AdaptiveBackground palette={data.palette ?? NEUTRAL_PALETTE} />
      <div className="wrap">
        <header className={styles.prof}>
          <div className={styles.idBlock}>
            <div className={styles.id}>
              <Avatar
                handle={profile.handle}
                name={profile.displayName}
                size={84}
                className={styles.avatar}
              />
              <div>
                <h1>{profile.displayName}</h1>
                <div className={styles.handle}>
                  @{profile.handle} · stubbing since {since}
                </div>
              </div>
            </div>
            {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
            <EditProfile profile={profile} />
          </div>
          <ul className={styles.stats} aria-label="Stats">
            <li className={styles.stat}>
              <b>{stats.totalStubs}</b>
              <span>Total stubs</span>
            </li>
            <li className={styles.stat}>
              <b>{stats.stubsThisYear}</b>
              <span>Stubs in {year}</span>
            </li>
            <li className={styles.stat}>
              <b>{stats.rewatches}</b>
              <span>Rewatches</span>
            </li>
            <li className={styles.stat}>
              <b>×{stats.mostStubbed?.count ?? 0}</b>
              <span>
                {stats.mostStubbed ? (
                  <Link href={titleHref(stats.mostStubbed.title)} className={styles.statLink}>
                    {stats.mostStubbed.title.title}
                  </Link>
                ) : (
                  '—'
                )}
                <br />
                most stubbed
              </span>
            </li>
          </ul>
        </header>

        <nav className={styles.tabs} aria-label="Profile sections">
          {tabLink('wallet', 'Stub wallet')}
          {tabLink('diary', 'Diary')}
          {tabLink('reviews', `Reviews · ${stats.reviewCount}`)}
          <OwnerOnly handle={profile.handle}>{tabLink('watchlist', 'Watchlist')}</OwnerOnly>
        </nav>

        <div className={styles.panel}>
          {tab === 'wallet' &&
            (wallet.items.length ? (
              <WalletGrid items={wallet.items} />
            ) : (
              <OwnerSwitch
                handle={profile.handle}
                owner={
                  <EmptyState
                    title="Your wallet is empty"
                    action={
                      <Link href="/browse" className="btn btn--primary">
                        Browse 6.5+ titles
                      </Link>
                    }
                  >
                    Every watch earns a stub. Find something good and tap Stub it.
                  </EmptyState>
                }
                visitor={
                  <EmptyState title="No stubs yet">
                    @{profile.handle} hasn&apos;t stubbed anything yet.
                  </EmptyState>
                }
              />
            ))}
          {tab === 'diary' &&
            (diary.items.length ? (
              <>
                <OwnerOnly handle={profile.handle}>
                  <p className={styles.ownerNote}>
                    <Link href="/me/stubs" className="link">
                      Edit or delete stubs in My stubs
                    </Link>
                  </p>
                </OwnerOnly>
                <DiaryList entries={diary.items} />
              </>
            ) : (
              <EmptyState title="No stubs yet">The diary fills up one watch at a time.</EmptyState>
            ))}
          {tab === 'reviews' &&
            (reviews.items.length ? (
              <div>
                {reviews.items.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    reportTitle={`${r.title.title} (${r.title.year})`}
                    eyebrow={
                      <Link href={titleHref(r.title)} className={`eyebrow ${styles.rvTitle}`}>
                        {r.title.title} · {r.title.year}
                      </Link>
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="No reviews yet">Stars are enough. Words are a bonus.</EmptyState>
            ))}
          {tab === 'watchlist' && <OwnerWatchlist handle={profile.handle} />}
          {next && (
            <div className={styles.more}>
              <Link href={next} className="btn btn--ghost">
                Older
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
