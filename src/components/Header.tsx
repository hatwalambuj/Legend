/** App header (DESIGN §7.1): logo, primary nav + search (≥ 900px), demo pill, user island. */
import Link from 'next/link';
import { DemoPill } from './DemoPill';
import { HeaderNav, HeaderUser } from './HeaderNav';
import { HeaderSearch } from './HeaderSearch';
import { LogoMark } from './Icon';
import styles from './Header.module.css';
import { BRAND_NAME } from '@/lib/brand';

export function Header({ isDemo, demoResets = false }: { isDemo: boolean; demoResets?: boolean }) {
  return (
    <header className={styles.hdr}>
      <div className={`wrap ${styles.in}`}>
        <Link href="/" className={styles.logo} aria-label={`${BRAND_NAME} home`}>
          <LogoMark />
          <span aria-hidden="true">{BRAND_NAME}</span>
        </Link>
        <HeaderNav />
        <div className={styles.searchSlot}>
          <HeaderSearch />
        </div>
        <div className={styles.right}>
          {isDemo && <DemoPill resets={demoResets} />}
          <HeaderUser />
        </div>
      </div>
    </header>
  );
}
