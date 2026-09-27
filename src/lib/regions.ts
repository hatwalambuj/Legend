/**
 * Supported watch regions (ADR-012 §5): ISO 3166-1 alpha-2 code → English name. A static map, so SSR and
 * hydration print the same name (no `Intl` at render). Client-safe. OWNER: Architect (landed in W-00).
 *
 * `WATCH_REGIONS` (env) must be a subset of these codes, else the server refuses to boot (src/server/env.ts).
 * Adding a region here costs nothing; enabling it in `WATCH_REGIONS` adds 2 provider-list calls a week.
 */

export interface RegionEntry {
  code: string;
  name: string;
}

/** Sorted by code. Names follow common English usage ("United Kingdom", not "Great Britain"). */
export const REGIONS: readonly RegionEntry[] = [
  { code: 'AR', name: 'Argentina' },
  { code: 'AT', name: 'Austria' },
  { code: 'AU', name: 'Australia' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'US', name: 'United States' },
  { code: 'ZA', name: 'South Africa' },
];

const NAMES: ReadonlyMap<string, string> = new Map(REGIONS.map((r) => [r.code, r.name]));

/** ADR-012 §5 defaults (all optional env; demo needs none, W8-AC1). */
export const DEFAULT_WATCH_REGION = 'US';
export const DEFAULT_WATCH_REGIONS: readonly string[] = [
  'US',
  'GB',
  'IN',
  'CA',
  'AU',
  'DE',
  'FR',
  'ES',
  'BR',
  'MX',
];

/** Common non-ISO aliases people (and some headers) use. `UK` is reserved, not assigned, in ISO 3166. */
const ALIASES: Readonly<Record<string, string>> = { UK: 'GB' };

/**
 * Normalises a region input: 2 ASCII letters, upper-cased, `UK→GB`. Anything else → null.
 * Does NOT check support (that is config: `WATCH_REGIONS`).
 */
export function normalizeRegionCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!/^[A-Za-z]{2}$/.test(s)) return null;
  const up = s.toUpperCase();
  return ALIASES[up] ?? up;
}

/** Display name for a known code, else null. */
export function regionName(code: string): string | null {
  return NAMES.get(code) ?? null;
}

export function isKnownRegion(code: string): boolean {
  return NAMES.has(code);
}
