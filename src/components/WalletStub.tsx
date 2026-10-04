'use client';
/**
 * Torn stub in the wallet (DESIGN §3.2 stub/torn): zig-zag left edge, palette strip, title, last date,
 * vertical ADMIT ONE; rewatches stack 1–2 paper layers behind plus a ×N tag. Slight rotation.
 * Below the card: Share stub (anyone) and the owner-only Story image for the latest stub, plus "S03" for a
 * season stub, like the diary row (ADR-013 C-07/C-08/C-10; API_CONTRACT v1.6.1). Client: the actions click.
 */
import Link from 'next/link';
import { seasonLabel, titleScores } from '@/lib/format';
import { paletteOrDefault } from '@/lib/images';
import { titleHref } from '@/lib/routes';
import type { WalletItem } from '@/lib/types';
import { formatDate, kindLabel, stubPrint } from './lib/display';
import { OwnerOnly } from './Owner';
import { ShareButton, shareStory, shareTitle } from './ShareButton';
import { tintAttrs } from './Ticket';
import styles from './WalletStub.module.css';

const ROT = [-2.2, 1.6, -0.8, 2.4, -1.4, 0.9, -2.8, 1.2, -0.4];

export function WalletStub({
  item,
  index,
  handle,
}: {
  item: WalletItem;
  index: number;
  /** The wallet owner's handle: shows Story image to that signed-in user only. */
  handle?: string;
}) {
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
  const season = t.mediaType === 'tv' ? seasonLabel(item.latestSeason) : '';
  const rated = `rated ${tmdb?.value} on TMDB${imdb ? ` and ${imdb.value} on IMDb` : ''}`;
  return (
    <div className={styles.item}>
      <Link
        href={titleHref(t)}
        className={styles.ws}
        style={{ ['--rot' as string]: `${ROT[index % ROT.length]}deg` }}
        aria-label={`${t.title}, ${season ? `season ${item.latestSeason}, ` : ''}stubbed ${n} time${n === 1 ? '' : 's'}, last ${formatDate(item.lastWatchedOn)}, ${rated}`}
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
              {season && (
                <>
                  {' · '}
                  <span data-testid="wallet-season">{season}</span>
                </>
              )}
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
      <span className={styles.acts}>
        <ShareButton
          target={{ kind: 'stub', stubId: item.latestStubId, title: shareTitle(t) }}
          surface="stub"
          label={`Share stub for ${t.title}`}
        />
        {handle && (
          <OwnerOnly handle={handle}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="share-story"
              aria-label={`Story image for ${t.title}`}
              onClick={() => void shareStory(item.latestStubId, item.count, t.title)}
            >
              Story image
            </button>
          </OwnerOnly>
        )}
      </span>
    </div>
  );
}

export function WalletGrid({ items, handle }: { items: WalletItem[]; handle?: string }) {
  return (
    <ul className={styles.wallet} aria-label="Stub wallet">
      {items.map((it, i) => (
        <li key={it.title.key}>
          <WalletStub item={it} index={i} handle={handle} />
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
