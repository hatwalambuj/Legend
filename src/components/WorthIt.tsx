/**
 * "Worth it?" programme slip (DESIGN §7.4.1, ADR-009). Renders `title.worthIt` exactly as given:
 * every missing line is omitted, a TMDB-sourced hook carries "FROM TMDB", and no number is printed
 * (the numbers live in the score chips). Ink on paper, so contrast never depends on the tint.
 */
import type { WorthIt as WorthItData } from '@/lib/types';
import { LikeLine } from './LikeLine';
import { WorthItSeen } from './WorthItSeen';
import styles from './WorthIt.module.css';

export function WorthIt({ data }: { data: WorthItData }) {
  const { hook, vibes, time, certification, verdict, likeCandidates } = data;
  return (
    <section className={styles.slip} aria-labelledby="worth-it-h" data-testid="worth-it">
      <div className={styles.strip} aria-hidden="true">
        <span>WORTH IT?</span>
      </div>
      <div className={styles.body}>
        <h2 id="worth-it-h" className={styles.h}>
          Worth it?
        </h2>
        {hook && (
          <p className={styles.hook} data-testid="worth-it-hook">
            {hook.text}
            {hook.source.startsWith('tmdb_') && <span className={styles.from}> FROM TMDB</span>}
          </p>
        )}
        {vibes.length > 0 && (
          <ul className={styles.vibes} data-testid="worth-it-vibes" aria-label="Vibes">
            {vibes.slice(0, 3).map((v) => (
              <li key={v.id} className={styles.chip}>
                {v.label}
              </li>
            ))}
          </ul>
        )}
        {(time || certification) && (
          <div className={styles.timeRow}>
            {time && (
              <span className={styles.time} data-testid="worth-it-time">
                <span aria-hidden="true">{time.label}</span>
                <span className="sr-only">{time.ariaLabel}</span>
              </span>
            )}
            {certification && (
              <span
                className={styles.cert}
                data-testid="worth-it-cert"
                role="img"
                aria-label={`Rated ${certification}`}
              >
                {certification}
              </span>
            )}
          </div>
        )}
        <div className={styles.verdict} data-testid="worth-it-verdict">
          <p className={styles.word}>
            {verdict.word}
            {verdict.key === 'split_opinions' && <span className={styles.split}>SPLIT</span>}
          </p>
          <p className={styles.source}>
            {verdict.sourceLine}
            {verdict.splitNote && <> · {verdict.splitNote}</>}
          </p>
        </div>
        {likeCandidates.length > 0 && <LikeLine candidates={likeCandidates} />}
      </div>
      <WorthItSeen verdict={verdict.key} />
    </section>
  );
}
