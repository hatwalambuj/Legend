/**
 * Pure formatting for `scripts/metrics.ts` (ADR-013 C-09): one line per ISO week from the
 * `metrics_weekly` view. Aggregates only; the view holds nothing new about a person. OWNER: Backend.
 */
export interface MetricsWeek {
  week: string;
  weekly_active_stubbers: number;
  signups: number;
  activated: number;
  median_hours_to_first_stub: number | string | null;
  stubs: number;
  reviews: number;
  review_rate: number | string | null;
  rewatch_share: number | string | null;
  events: Record<string, number | string> | null;
}

const pct = (v: number | string | null) => (v === null ? '–' : `${(Number(v) * 100).toFixed(1)}%`);

export function formatMetrics(rows: MetricsWeek[]): string {
  const head =
    'week        WAS  signups  activated  med_h_1st  stubs  reviews  review%  rewatch%  events';
  const lines = rows.map((r) => {
    const ev = Object.entries(r.events ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => `${k}=${Number(n)}`)
      .join(' ');
    return [
      String(r.week).slice(0, 10).padEnd(10),
      String(r.weekly_active_stubbers).padStart(5),
      String(r.signups).padStart(8),
      String(r.activated).padStart(10),
      (r.median_hours_to_first_stub === null ? '–' : String(r.median_hours_to_first_stub)).padStart(
        10,
      ),
      String(r.stubs).padStart(6),
      String(r.reviews).padStart(8),
      pct(r.review_rate).padStart(8),
      pct(r.rewatch_share).padStart(9),
      ` ${ev || '–'}`,
    ].join(' ');
  });
  return [head, ...lines].join('\n');
}
