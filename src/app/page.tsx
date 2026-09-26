import { dal } from '@/server/dal';

// OWNER: Frontend. PLACEHOLDER proving the scaffold wiring (DAL → fixtures) — replace with the real Home.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const mode = dal.getMode();
  const page = await dal.listCatalog({ type: 'all', sort: 'release_desc', limit: 12 });
  return (
    <main className="wrap" style={{ paddingBlock: 48 }}>
      {mode.isDemo && (
        <span
          className="demo-pill"
          data-testid="demo-pill"
          title="No API keys found — running on bundled demo data"
        >
          Demo data
        </span>
      )}
      <h1
        style={{
          font: '800 clamp(44px, 9vw, 120px)/.88 var(--font-display)',
          letterSpacing: '-0.055em',
        }}
      >
        Only the good stuff.
      </h1>
      <p className="mono" style={{ color: 'var(--fg-2)' }}>
        {page.total} titles · 6.5+ only
      </p>
      <ul>
        {page.items.map((t) => (
          <li key={t.key}>
            {t.title} ({t.year}) · {t.voteAverage.toFixed(1)} TMDB
          </li>
        ))}
      </ul>
    </main>
  );
}
