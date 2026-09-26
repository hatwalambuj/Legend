import { describe, expect, it } from 'vitest';
import { addDays, validateWatchedOn } from './stubs';

describe('watchedOn rules (ADR-004 §2)', () => {
  const dune = { releaseDate: '2024-02-27', year: 2024 };
  const fails = (d: string) => {
    try {
      validateWatchedOn(d, dune, '2026-09-26');
      return null;
    } catch (e) {
      return (e as { fields?: Record<string, string> }).fields?.watchedOn ?? 'other';
    }
  };
  it('allows today and one day of timezone slack; rejects the future', () => {
    expect(fails('2026-09-26')).toBeNull();
    expect(fails('2026-09-27')).toBeNull();
    expect(fails('2026-09-28')).toMatch(/hasn't happened/);
  });
  it('allows from Jan 1 of (release year − 1)', () => {
    expect(fails('2023-01-01')).toBeNull();
    expect(fails('2022-12-31')).toMatch(/before/);
  });
  it('date arithmetic crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});
