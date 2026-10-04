import { describe, expect, it } from 'vitest';
import { formatErrorCounts, windowStart } from './metrics';

describe('error counters in metrics output (AR-C2)', () => {
  it('windowStart covers 7 UTC days including today', () => {
    expect(windowStart(7, new Date('2026-10-04T23:00:00Z'))).toBe('2026-09-28');
    expect(windowStart(1, new Date('2026-10-04T00:00:00Z'))).toBe('2026-10-04');
  });

  it('totals per name:dim, highest first, with per-day counts', () => {
    const out = formatErrorCounts([
      { day: '2026-10-03', name: 'client_error', dim: 'boundary', count: '2' },
      { day: '2026-10-04', name: 'server_error', dim: 'api:titles', count: 3 },
      { day: '2026-10-02', name: 'server_error', dim: 'api:titles', count: '4' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('errors (last 7 days, UTC)');
    expect(lines[1]).toMatch(/^ {2}server_error:api:titles\s+7 {2}10-02=4 10-04=3$/);
    expect(lines[2]).toMatch(/^ {2}client_error:boundary\s+2 {2}10-03=2$/);
  });

  it('says none when there are no errors', () => {
    expect(formatErrorCounts([])).toBe('errors (last 7 days, UTC)\n  none');
  });
});
