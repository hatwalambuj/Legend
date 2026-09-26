'use client';
/** Mobile bottom tab bar (≤ 900px): Discover · Search · Wallet (badge) · You. 48px targets. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { profileHref } from '@/lib/routes';
import { useApp } from '@/hooks/useApp';
import { walletHref, WalletBadge } from './HeaderNav';
import { Icon } from './Icon';
import styles from './TabBar.module.css';

export function TabBar() {
  const pathname = usePathname();
  const { session } = useApp();
  const handle = session?.user.handle;
  const onWallet = handle ? pathname === profileHref(handle) : false;
  const youHref = session ? '/me/settings' : '/signin';
  return (
    <nav className={styles.tabbar} aria-label="Primary">
      <Link
        href="/"
        aria-current={pathname === '/' || pathname.startsWith('/browse') ? 'page' : undefined}
      >
        <Icon name="home" size={22} />
        Discover
      </Link>
      <Link href="/search" aria-current={pathname.startsWith('/search') ? 'page' : undefined}>
        <Icon name="search" size={22} />
        Search
      </Link>
      <Link
        href={walletHref(handle)}
        prefetch={handle ? undefined : false}
        aria-current={onWallet || pathname.startsWith('/me/stubs') ? 'page' : undefined}
        data-wallet-target=""
      >
        <Icon name="wallet" size={22} />
        Wallet
        <WalletBadge className={styles.badge} />
      </Link>
      <Link
        href={youHref}
        prefetch={session ? undefined : false}
        aria-current={
          pathname.startsWith('/me/settings') || pathname === '/signin' ? 'page' : undefined
        }
      >
        <Icon name="user" size={22} />
        You
      </Link>
    </nav>
  );
}
