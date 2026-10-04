import { GridSkeleton } from '@/components/TicketGrid';
import sk from '@/components/Skeleton.module.css';

// OWNER: Frontend. Browse loading state (ADR-013 C-03: browse has no 404 case, so it keeps a route skeleton).
export default function Loading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading">
      <div style={{ padding: '40px 0 24px', display: 'grid', gap: 14 }}>
        <span className={sk.bar} style={{ width: 160 }} />
        <span className={sk.bar} style={{ width: '50%', height: 56 }} />
      </div>
      <GridSkeleton count={10} />
    </div>
  );
}
