/** Grid / rail containers for tickets (DESIGN §2.8): 2 / 3 / 4 / 5 / 6 columns; rails scroll inside. */
import type { TitleSummary } from '@/lib/types';
import { Ticket, TicketSkeleton } from './Ticket';
import styles from './TicketGrid.module.css';

export function TicketGrid({
  titles,
  label,
  priorityCount = 0,
}: {
  titles: TitleSummary[];
  label?: string;
  priorityCount?: number;
}) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {titles.map((t, i) => (
        <li key={t.key}>
          <Ticket title={t} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export function TicketRail({ titles, label }: { titles: TitleSummary[]; label: string }) {
  return (
    <ol className={styles.rail} aria-label={label} data-rail="">
      {titles.map((t, i) => (
        <li key={t.key}>
          <Ticket title={t} variant="rail" rank={i + 1} priority={i < 2} />
        </li>
      ))}
    </ol>
  );
}

export function GridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <TicketSkeleton key={i} />
      ))}
    </div>
  );
}

export function RailSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.rail} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <TicketSkeleton key={i} />
      ))}
    </div>
  );
}
