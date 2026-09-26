'use client';
// OWNER: Frontend. Segment error boundary (DESIGN §10: "The projector jammed").
import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '@/components/EmptyState';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="wrap" style={{ paddingBlock: 72 }}>
      <EmptyState
        headingLevel="h1"
        title="The projector jammed"
        action={
          <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={() => retry()}>
              Try again
            </button>
            <Link className="btn btn--ghost" href="/">
              Back to Discover
            </Link>
          </span>
        }
      >
        We couldn&apos;t load this screen.{error.digest ? ` (ref ${error.digest})` : ''}
      </EmptyState>
    </div>
  );
}
