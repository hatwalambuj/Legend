import { TicketSkeleton } from '@/components/Ticket';
import styles from './title.module.css';
import sk from '@/components/Skeleton.module.css';

export default function Loading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading title">
      <div className={styles.detail}>
        <div className={styles.ticket}>
          <TicketSkeleton />
        </div>
        <div className={styles.info}>
          <span className={sk.bar} style={{ width: '30%' }} />
          <span className={sk.bar} style={{ width: '80%', height: 64, marginTop: 16 }} />
          <span className={sk.bar} style={{ width: '60%', marginTop: 16 }} />
          <button type="button" className="btn btn--primary btn--lg" disabled style={{ marginTop: 24 }}>
            Stub it
          </button>
        </div>
      </div>
    </div>
  );
}
