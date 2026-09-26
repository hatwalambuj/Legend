import { GridSkeleton, RailSkeleton } from '@/components/TicketGrid';
import sk from '@/components/Skeleton.module.css';

// OWNER: Frontend. Default route loading state (DESIGN §7.1): skeleton rail of 6 + grid of 10.
export default function Loading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading">
      <div style={{ padding: '40px 0 24px', display: 'grid', gap: 14 }}>
        <span className={sk.bar} style={{ width: 220 }} />
        <span className={sk.bar} style={{ width: '70%', height: 72 }} />
      </div>
      <RailSkeleton count={6} />
      <GridSkeleton count={10} />
    </div>
  );
}
