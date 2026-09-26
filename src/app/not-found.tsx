import Link from 'next/link';
import { AdaptiveBackground } from '@/components/AdaptiveBackground';
import { EmptyState } from '@/components/EmptyState';
import { NEUTRAL_PALETTE } from '@/lib/images';

// OWNER: Frontend. 404 (DESIGN §7.9): a ticket-shaped empty state on a neutral tint.
export default function NotFound() {
  return (
    <>
      <AdaptiveBackground palette={NEUTRAL_PALETTE} />
      <div className="wrap" style={{ paddingBlock: 72 }}>
        <EmptyState
          headingLevel="h1"
          title="Wrong screen. This ticket doesn't exist."
          testId="not-found"
          action={
            <Link className="btn btn--primary" href="/">
              Back to Discover
            </Link>
          }
        >
          We couldn&apos;t find that page, title or person. It may have left the catalogue.
        </EmptyState>
      </div>
    </>
  );
}
