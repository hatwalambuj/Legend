'use client';
/** Desktop primary nav + header user island (avatar / sign in) — personal bits come from /api/me. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { profileHref } from '@/lib/routes';
import { useApp } from '@/hooks/useApp';
import { Avatar } from './Avatar';
import styles from './Header.module.css';

export function walletHref(handle: string | undefined): string {
  return handle ? profileHref(handle) : '/signin?next=/me/stubs';
}

export function WalletBadge({ className }: { className?: string }) {
  const { walletCount } = useApp();
  if (walletCount === null) return null;
  return (
    <span className={className} data-wallet-badge="" aria-label={`${walletCount} stubs`}>
      {walletCount > 99 ? '99+' : walletCount}
    </span>
  );
}

export function HeaderNav() {
  const pathname = usePathname();
  const { session } = useApp();
  const handle = session?.user.handle;
  const wallet = walletHref(handle);
  const onWallet = handle ? pathname === profileHref(handle) : pathname.startsWith('/me/stubs');
  return (
    <nav className={styles.nav} aria-label="Primary">
      <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
        Discover
      </Link>
      <Link href="/browse" aria-current={pathname.startsWith('/browse') ? 'page' : undefined}>
        Browse
      </Link>
      <Link href={wallet} aria-current={onWallet ? 'page' : undefined} data-wallet-target="">
        Stub wallet <WalletBadge className={styles.badge} />
      </Link>
    </nav>
  );
}

export function HeaderUser() {
  const { session, sessionReady, openAuth } = useApp();
  if (!sessionReady) return <span className={styles.userSkeleton} aria-hidden="true" />;
  if (!session)
    return (
      <a
        href="/signin"
        className={`btn btn--ghost btn--sm ${styles.signin}`}
        onClick={(e) => {
          e.preventDefault();
          openAuth({ kind: 'signin' });
        }}
      >
        Sign in
      </a>
    );
  const u = session.user;
  return (
    <Link
      href={profileHref(u.handle)}
      className={styles.avatarLink}
      aria-label={`Your profile (@${u.handle})`}
    >
      <Avatar handle={u.handle} name={u.displayName} size={36} />
    </Link>
  );
}
