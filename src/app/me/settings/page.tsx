import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { DeleteAccount } from '@/components/DeleteAccount';
import { EditProfile } from '@/components/Owner';
import { safe } from '@/components/lib/safe';
import { SignOutButton } from '@/components/SignOutButton';
import { api } from '@/lib/api-client';
import { NEUTRAL_PALETTE } from '@/lib/images';
import { profileHref } from '@/lib/routes';
import { dal } from '@/server/dal';
import styles from './settings.module.css';

// OWNER: Frontend. Settings (DESIGN §7.9): profile, account, export, sign out. Private.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function SettingsPage() {
  const session = await dal.getSession();
  if (!session) redirect('/signin?next=/me/settings');
  const u = session.user;
  const profile = await safe(dal.getProfile(u.handle), null, 'getProfile');

  return (
    <>
      <AdaptiveBackground palette={profile?.palette ?? NEUTRAL_PALETTE} />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">@{u.handle}</div>
          <h1>Settings</h1>
        </div>
        <div className={styles.grid}>
          <section className={styles.card} aria-labelledby="set-profile">
            <h2 id="set-profile">Profile</h2>
            <p>
              {u.displayName} ·{' '}
              <Link className="link" href={profileHref(u.handle)}>
                @{u.handle}
              </Link>
            </p>
            {profile && <EditProfile profile={profile.profile} />}
          </section>
          <section className={styles.card} aria-labelledby="set-account">
            <h2 id="set-account">Account</h2>
            <dl className={styles.dl}>
              <div>
                <dt>Email</dt>
                <dd>{u.email}</dd>
              </div>
              <div>
                <dt>Handle</dt>
                <dd>@{u.handle} (can&apos;t be changed)</dd>
              </div>
            </dl>
            <p className={styles.hint}>
              Forgot your password? Use &ldquo;Email me a magic link&rdquo; on the sign-in screen.
            </p>
          </section>
          <section className={styles.card} id="export" aria-labelledby="set-export">
            <h2 id="set-export">Export</h2>
            <p>
              Your stubs, ratings and reviews are yours. Letterboxd CSV imports straight into
              Letterboxd.
            </p>
            <div className={styles.row}>
              <a
                className="btn btn--ghost"
                href={api.exportUrl('letterboxd')}
                download
                data-testid="export-letterboxd"
              >
                Letterboxd CSV
              </a>
              <a
                className="btn btn--ghost"
                href={api.exportUrl('json')}
                download
                data-testid="export-json"
              >
                JSON
              </a>
            </div>
          </section>
          <section className={styles.card} aria-labelledby="set-out">
            <h2 id="set-out">Sign out</h2>
            <p>You can sign back in any time. Your stubs stay put.</p>
            <SignOutButton />
          </section>
          <section className={styles.card} id="delete" aria-labelledby="set-delete">
            <h2 id="set-delete">Delete account</h2>
            <p>
              Permanently erase your account and everything in it: stubs, ratings, reviews and
              watchlist.
            </p>
            <DeleteAccount />
          </section>
        </div>
      </div>
    </>
  );
}
