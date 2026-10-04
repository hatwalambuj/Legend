'use client';
// OWNER: Frontend. Root error boundary (ADR-013 C-13): replaces the root layout, so it brings its own
// <html>/<body> and only inline styles (globals.css and the fonts may not have loaded).
import { useEffect } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { reportError } from '@/lib/report-error';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportError({
      kind: 'global',
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0B0B0D',
          color: '#F4F1EA',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <main>
          <h1 style={{ fontSize: 28, margin: '0 0 12px' }}>The projector jammed</h1>
          <p style={{ color: '#BDB8AE', margin: '0 0 24px' }}>
            {BRAND_NAME} couldn&apos;t load.{error.digest ? ` (ref ${error.digest})` : ''}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              font: 'inherit',
              fontWeight: 600,
              padding: '12px 20px',
              borderRadius: 999,
              border: 0,
              background: '#FF5B3A',
              color: '#141210',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
