/** Global footer with the required attribution (DESIGN §8): TMDB logo + notice, "IMDb ratings via OMDb". */
import Image from 'next/image';
import Link from 'next/link';
import { CONTACT_EMAIL, contactHref } from '@/lib/contact';
import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.foot}>
      <div className={`wrap ${styles.in}`}>
        <div className={styles.attr}>
          <a href="https://www.themoviedb.org/" rel="noopener noreferrer" target="_blank">
            <Image src="/tmdb-logo.svg" alt="TMDB" width={72} height={18} unoptimized />
          </a>
          <span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
        </div>
        <div className={styles.attr}>
          <span>IMDb ratings via OMDb. Reviews and ratings you write stay on Stubbed.</span>
        </div>
        <nav aria-label="Footer" className={styles.links}>
          <Link href="/about">About</Link>
          <Link href="/about#credits">Credits</Link>
          <Link href="/me/settings#export">Export my data</Link>
          <Link href="/about#privacy">Privacy</Link>
          <Link href="/about#terms">Terms</Link>
          {/* GAP-06: the address is visible too, for people without a mail app. */}
          <a href={contactHref()} data-testid="footer-contact">
            Contact <span className={styles.email}>{CONTACT_EMAIL}</span>
          </a>
        </nav>
        <div className={`mono ${styles.print}`}>STUBBED · PROOF YOU WATCHED · ONLY 6.5+</div>
      </div>
    </footer>
  );
}
