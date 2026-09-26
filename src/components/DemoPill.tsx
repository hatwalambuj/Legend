/** "● DEMO DATA" (DESIGN §6, PRD E2): shown on every page while fixture/local mode is active. */
export function DemoPill() {
  return (
    <span
      className="demo-pill"
      data-testid="demo-pill"
      title="No API keys found — running on bundled demo data"
      tabIndex={0}
      aria-label="Demo data: no API keys found, running on bundled demo data"
    >
      Demo data
    </span>
  );
}
