'use client';
// OWNER: Frontend. Segment error boundary (DESIGN §10: "The projector jammed").
import Link from 'next/link';
import { useEffect } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { reportError } from '@/lib/report-error';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // ADR-013 C-13: one small first-party beacon to /api/log (no query, no user data).
    reportError({
      kind: 'boundary',
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);
  return (
    <div className="wrap" style={{ paddingBlock: 72 }}>
      <EmptyState
        headingLevel="h1"
        title="The projector jammed"
        action={
          <span
            style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}
          >
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
