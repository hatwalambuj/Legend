/**
 * Degraded title page notice (ADR-011 §4, M1-06). Server component. `catalog` = our DB is unreachable
 * and the page is a lighter copy (stubs, reviews and watchlist paused); `community` = stats missing.
 * The `catalog` copy carries `DEGRADED_DESC_ID` so paused CTAs can use it as their accessible description.
 */
import type { TitleDegraded } from '@/lib/types';
import { Icon } from './Icon';
import styles from './DegradedBanner.module.css';

export const DEGRADED_DESC_ID = 'degraded-desc';

export const DEGRADED_COPY = {
  catalog:
    "We can't reach our database right now. You're seeing a lighter version of this page. Stubs and reviews are paused.",
  community: 'Community stats are taking a break.',
} as const;

export function DegradedBanner({ degraded }: { degraded: TitleDegraded | undefined }) {
  if (!degraded) return null;
  return (
    <div
      className={styles.banner}
      role="status"
      data-testid="degraded-banner"
      data-degraded={degraded}
    >
      <Icon name="alert" size={16} />
      <p id={degraded === 'catalog' ? DEGRADED_DESC_ID : undefined}>{DEGRADED_COPY[degraded]}</p>
    </div>
  );
}
