/**
 * Torn stub in the wallet (DESIGN §3.2 stub/torn): zig-zag left edge, palette strip, title, last date,
 * vertical ADMIT ONE; rewatches stack 1–2 paper layers behind plus a ×N tag. Slight rotation.
 */
import Link from 'next/link';
import { titleScores } from '@/lib/format';
import { paletteOrDefault } from '@/lib/images';
import { titleHref } from '@/lib/routes';
import type { WalletItem } from '@/lib/types';
import { formatDate, kindLabel, stubPrint } from './lib/display';
import { tintAttrs } from './Ticket';
import styles from './WalletStub.module.css';

const ROT = [-2.2, 1.6, -0.8, 2.4, -1.4, 0.9, -2.8, 1.2, -0.4];

export function WalletStub({ item, index }: { item: WalletItem; index: number }) {
  const t = item.title;
  const p = paletteOrDefault(
    t.palette,
    t.genres.map((g) => g.id),
  );
  const n = item.count;
  // GAP-02 / ADR-008: labelled TMDB score plus the IMDb chip (titleScores() hides an unknown IMDb).
  const scores = titleScores(t);
  const tmdb = scores.find((s) => s.source === 'tmdb');
  const imdb = scores.find((s) => s.source === 'imdb');
  const rated = `rated ${tmdb?.value} on TMDB${imdb ? ` and ${imdb.value} on IMDb` : ''}`;
  return (
    <Link
      href={titleHref(t)}
      className={styles.ws}
      style={{ ['--rot' as string]: `${ROT[index % ROT.length]}deg` }}
      aria-label={`${t.title}, stubbed ${n} time${n === 1 ? '' : 's'}, last ${formatDate(item.lastWatchedOn)}, ${rated}`}
      data-testid="wallet-stub"
      {...tintAttrs(t)}
    >
      {n > 2 && <span className={`${styles.layer} ${styles.l2}`} aria-hidden="true" />}
      {n > 1 && <span className={`${styles.layer} ${styles.l1}`} aria-hidden="true" />}
      <span className={styles.paper} aria-hidden="true">
        <span className={styles.main}>
          <span
            className={styles.strip}
            style={{ backgroundImage: `linear-gradient(90deg, ${p.vibrant}, ${p.base})` }}
          />
          <span className={styles.t}>{t.title}</span>
          <span className={styles.d}>
            {formatDate(item.lastWatchedOn)}
            <br />
            {kindLabel(t.mediaType)}
          </span>
          <span className={styles.sc}>
            {tmdb && (
              <span data-testid="tmdb-rating">
                {tmdb.label} {tmdb.value}
              </span>
            )}
            {imdb && (
              <span className={styles.imdb} data-testid="imdb-rating">
                <span className="imdb-mark imdb-mark--xs">IMDb</span>
                {imdb.value}
              </span>
            )}
          </span>
        </span>
        <span className={styles.side}>
          <span>{stubPrint(t)}</span>
        </span>
      </span>
      {n > 1 && (
        <span className={styles.x} aria-hidden="true">
          ×{n}
        </span>
      )}
    </Link>
  );
}

export function WalletGrid({ items }: { items: WalletItem[] }) {
  return (
    <ul className={styles.wallet} aria-label="Stub wallet">
      {items.map((it, i) => (
        <li key={it.title.key}>
          <WalletStub item={it} index={i} />
        </li>
      ))}
    </ul>
  );
}

export function WalletSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={styles.wallet} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={styles.sk} />
      ))}
    </div>
  );
}
