'use client';
/**
 * "If you liked…" (P1, DESIGN §7.4.1 line 6): public payload shows the first candidate; this private
 * island prefers one the signed-in user has stubbed ("You stubbed …").
 */
import Link from 'next/link';
import { useEffect } from 'react';
import { titleHref } from '@/lib/routes';
import type { TitleSummary } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { kindLabel } from './lib/display';
import { Poster } from './Poster';
import styles from './LikeLine.module.css';

export function LikeLine({ candidates }: { candidates: TitleSummary[] }) {
  const { states, registerKeys } = useApp();
  const keys = candidates.map((c) => c.key).join(',');
  useEffect(() => {
    registerKeys(candidates.map((c) => c.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, registerKeys]);
  const stubbed = candidates.find((c) => (states[c.key]?.stubCount ?? 0) > 0);
  const t = stubbed ?? candidates[0];
  if (!t) return null;
  return (
    <div className={styles.like} data-testid="worth-it-like">
      <span className={styles.lead}>{stubbed ? 'You stubbed' : 'If you liked'}</span>
      <Link href={titleHref(t)} className={styles.row}>
        <Poster
          title={t.title}
          posterPath={t.posterPath}
          palette={t.palette}
          genreIds={t.genres.map((g) => g.id)}
          size="w92"
          bare
          className={styles.thumb}
        />
        <span className={styles.meta}>
          <b>{t.title}</b>
          <span>
            {t.year} · {kindLabel(t.mediaType)}
          </span>
        </span>
      </Link>
    </div>
  );
}
