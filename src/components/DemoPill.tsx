/**
 * "● DEMO DATA" (DESIGN §6, PRD E2): shown on every page while fixture/local mode is active. When the
 * demo data is not durable (public demo, reset on boot, in-memory or serverless store) it reads
 * "Demo: data resets" so nobody mistakes it for the real product (GAP-04).
 */
export function DemoPill({ resets = false }: { resets?: boolean }) {
  const explain = resets
    ? 'This is a demo. Accounts, stubs and reviews are wiped from time to time, so don’t keep anything here.'
    : 'No API keys found, running on bundled demo data.';
  return (
    <span
      className={`demo-pill${resets ? ' demo-pill--resets' : ''}`}
      role="note"
      data-testid="demo-pill"
      title={explain}
      tabIndex={0}
      aria-label={`${resets ? 'Demo: data resets' : 'Demo data'}. ${explain}`}
    >
      {resets ? (
        <span aria-hidden="true">
          Demo: <span className="demo-pill__rest">data resets</span>
        </span>
      ) : (
        'Demo data'
      )}
    </span>
  );
}
