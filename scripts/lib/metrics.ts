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

/** One `events` row (AR-C2 error counters). */
export interface ErrorCountRow {
  day: string;
  name: string;
  dim: string;
  count: number | string;
}

export const ERROR_EVENT_NAMES = ['client_error', 'server_error'] as const;

/** UTC `YYYY-MM-DD` of `days - 1` days before `now` (the first day of a `days`-day window). */
export function windowStart(days: number, now = new Date()): string {
  return new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Error counts of the last 7 days (Vercel Hobby keeps runtime logs ~1 h, so this is the history):
 * one line per `name:dim`, total first, then per-day counts, highest total first.
 */
export function formatErrorCounts(rows: ErrorCountRow[]): string {
  const head = 'errors (last 7 days, UTC)';
  if (rows.length === 0) return `${head}\n  none`;
  const by = new Map<string, { total: number; days: Map<string, number> }>();
  for (const r of rows) {
    const k = r.dim ? `${r.name}:${r.dim}` : r.name;
    const e = by.get(k) ?? { total: 0, days: new Map<string, number>() };
    const n = Number(r.count);
    e.total += n;
    e.days.set(r.day, (e.days.get(r.day) ?? 0) + n);
    by.set(k, e);
  }
  const lines = [...by]
    .sort(([a, x], [b, y]) => y.total - x.total || a.localeCompare(b))
    .map(([k, e]) => {
      const days = [...e.days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, n]) => `${d.slice(5)}=${n}`)
        .join(' ');
      return `  ${k.padEnd(28)} ${String(e.total).padStart(6)}  ${days}`;
    });
  return [head, ...lines].join('\n');
}
