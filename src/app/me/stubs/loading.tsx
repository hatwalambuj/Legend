import sk from '@/components/Skeleton.module.css';

// OWNER: Frontend. My stubs loading state (ADR-013 C-03: no 404 case, so it keeps a route skeleton).
export default function Loading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading">
      <div style={{ padding: '40px 0 24px', display: 'grid', gap: 14 }}>
        <span className={sk.bar} style={{ width: 160 }} />
        <span className={sk.bar} style={{ width: '40%', height: 56 }} />
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={sk.bar} style={{ width: '100%', height: 72 }} />
        ))}
      </div>
    </div>
  );
}
