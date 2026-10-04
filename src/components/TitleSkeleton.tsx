/**
 * Title page skeleton (ADR-013 C-03): the Suspense fallback once the page has confirmed the title exists
 * (no route loading.tsx, so a missing title is a real 404). Uses the title page grid classes.
 */
import styles from '@/app/title/[type]/[slug]/title.module.css';
import sk from './Skeleton.module.css';
import { TicketSkeleton } from './Ticket';

export function TitleSkeleton() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading title" data-testid="title-skeleton">
      <div className={styles.detail}>
        <div className={styles.ticket}>
          <TicketSkeleton />
        </div>
        <div className={styles.info}>
          <span className={sk.bar} style={{ width: '30%' }} />
          <span className={sk.bar} style={{ width: '80%', height: 64, marginTop: 16 }} />
          <span className={sk.bar} style={{ width: '60%', marginTop: 16 }} />
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled
            style={{ marginTop: 24 }}
          >
            Stub it
          </button>
        </div>
      </div>
    </div>
  );
}
