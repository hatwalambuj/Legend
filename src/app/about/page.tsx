import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { CONTACT_EMAIL, contactHref } from '@/lib/contact';
import { NEUTRAL_PALETTE } from '@/lib/images';
import { JUSTWATCH_ATTRIBUTION } from '@/lib/provider-links';
import styles from './about.module.css';

// OWNER: Frontend. About / Credits (DESIGN §7.9, §8): mission, TMDB notice + logo, OMDb + JustWatch credits,
// why we can't post to IMDb, data & privacy summary.
export const metadata: Metadata = {
  title: 'About & credits',
  description: 'Why Stubbed exists, where the data comes from, and what we do with yours.',
};

export default function AboutPage() {
  return (
    <>
      <AdaptiveBackground palette={NEUTRAL_PALETTE} />
      <div className="wrap">
        <div className="page-h">
          <div className="eyebrow">About</div>
          <h1>Proof you watched.</h1>
          <p>
            Stubbed is a diary for movies and shows that only lists titles rated 6.5 or higher on
            TMDB. Every watch earns a ticket stub; every rewatch adds another. No endless scroll of
            filler — just the good stuff and your proof that you saw it.
          </p>
        </div>
        <div className={styles.cols}>
          <section id="credits" aria-labelledby="credits-h" className={styles.card}>
            <h2 id="credits-h">Credits</h2>
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.logo}
            >
              <Image
                src="/tmdb-logo.svg"
                alt="The Movie Database (TMDB)"
                width={120}
                height={30}
                unoptimized
              />
            </a>
            <p>
              This product uses the TMDB API but is not endorsed or certified by TMDB. Titles,
              posters, cast, TMDB ratings and TMDB community reviews come from{' '}
              <a
                className="link"
                href="https://www.themoviedb.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                themoviedb.org
              </a>
              .
            </p>
            <p>
              IMDb ratings are provided by{' '}
              <a
                className="link"
                href="https://www.omdbapi.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                OMDb
              </a>{' '}
              and refreshed nightly. Stubbed is not affiliated with IMDb. When a title has no IMDb
              rating, we simply don&apos;t show one.
            </p>
            <p>
              &ldquo;Where to watch&rdquo; data is provided by{' '}
              <a
                className="link"
                href={JUSTWATCH_ATTRIBUTION.href}
                target="_blank"
                rel={JUSTWATCH_ATTRIBUTION.rel}
              >
                JustWatch
              </a>{' '}
              through TMDB. Availability changes often, so each title shows when we last checked,
              and a link opens the service in a new tab. We never add affiliate or tracking codes.
            </p>
            <p>
              The &ldquo;Worth it?&rdquo; summary is built from these ratings, runtimes and our own
              hand-written notes by fixed rules — no AI.
            </p>
          </section>
          <section aria-labelledby="imdb-h" className={styles.card}>
            <h2 id="imdb-h">Why we can&apos;t post to IMDb for you</h2>
            <p>
              IMDb has no public way for other apps to write reviews or ratings, and we won&apos;t
              ask for your IMDb password. So your stubs, ratings and reviews live on Stubbed only —
              we never post them to IMDb, TMDB or anywhere else.
            </p>
            <p>
              You can always take your data with you:{' '}
              <Link className="link" href="/me/settings#export">
                export a Letterboxd CSV or JSON
              </Link>
              .
            </p>
          </section>
          <section id="privacy" aria-labelledby="privacy-h" className={styles.card}>
            <h2 id="privacy-h">Your data &amp; privacy</h2>
            <ul>
              <li>
                We store your email, handle, stubs, ratings, reviews and watchlist. That&apos;s it.
              </li>
              <li>
                Where it lives: your email and password (hashed, never readable) sit in our sign-in
                service, Supabase Auth. Your profile, stubs, ratings, reviews and watchlist sit in
                our Supabase database.
              </li>
              <li>Diaries, wallets and reviews are public; your watchlist is private.</li>
              <li>
                Posters load straight from TMDB&apos;s image servers, which means TMDB can see your
                IP address when an image loads.
              </li>
              <li>
                No ads, no trackers, no selling data. Delete a stub or review any time, or{' '}
                <Link className="link" href="/me/settings#delete">
                  delete your whole account
                </Link>{' '}
                in Settings.
              </li>
              <li>
                Deleting your account erases it right away: profile, stubs, ratings, reviews and
                watchlist. Encrypted backups may still hold a copy for up to 14 days, then it&apos;s
                gone for good.
              </li>
            </ul>
          </section>
          <section id="terms" aria-labelledby="terms-h" className={styles.card}>
            <h2 id="terms-h">Terms, in plain words</h2>
            <p>
              <strong>13+ only:</strong> you must be 13 or older to use Stubbed.
            </p>
            <p>
              Stubbed is a free, non-commercial project, and TMDB and OMDb data is used under their
              non-commercial terms. Be kind: tag spoilers, no harassment, no spam. We may remove
              reviews or accounts that break this.
            </p>
            <p>
              Questions, data requests or a review to report:{' '}
              <a className="link" href={contactHref()}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
