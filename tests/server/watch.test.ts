/**
 * W-05 + W-06 (ADR-012 §6, §8; PRD W1, W4, W6): the pure read path, the demo fixtures, the DAL wiring
 * and the live provider directory / settings repositories.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import watchJson from '@/fixtures/watch.json';
import type { FixtureCatalog, FixtureWatch } from '@/fixtures/schema';
import { PROVIDER_LINK_HOSTS } from '@/lib/provider-links';
import type { WatchRegionInfo } from '@/lib/types';
import { AppError } from '@/lib/errors';
import { regionInfo, type RegionConfig } from '@/server/region';
import { SupabaseSettings, SupabaseWatchProviders } from '@/server/repositories/supabase';
import { rowToWatch, type CatalogRow } from '@/server/repositories/supabase/rows';
import { buildTitleWatch, isWatchFresh, type ProviderDirectory } from '@/server/watch';

const headerJar = { region: undefined as string | undefined, lang: '' };
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'stubbed_region' && headerJar.region ? { name: n, value: headerJar.region } : undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(headerJar.lang ? { 'accept-language': headerJar.lang } : {}),
}));

const { dal, titleWatchFor } = await import('@/server/dal');
const { container, resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton } = await import('@/server/repositories/memory/store');

const catalog = catalogJson as unknown as FixtureCatalog;
const fixtures = watchJson as unknown as FixtureWatch;
const CFG: RegionConfig = { defaultRegion: 'US', regions: ['US', 'GB', 'IN'], geoHeader: null };
const US = regionInfo('US', 'query', CFG);
const GB = regionInfo('GB', 'query', CFG);
const NOW = new Date('2026-09-27T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const TITLE = { mediaType: 'movie' as const, tmdbId: 693134, title: 'Dune: Part Two' };

const DIR: ProviderDirectory = new Map([
  [8, { name: 'Netflix', logoPath: '/n.jpg' }],
  [337, { name: 'Disney Plus', logoPath: null }],
  [73, { name: 'Tubi', logoPath: null }],
  [38, { name: 'BBC iPlayer', logoPath: null }],
  [2, { name: 'Apple TV', logoPath: null }],
  [3, { name: 'Google Play Movies', logoPath: null }],
  [10, { name: 'Amazon Video', logoPath: null }],
  [555, { name: 'Unconfigured', logoPath: null }],
]);

const build = (
  store: unknown,
  opts: { checkedAt?: string | null; region?: WatchRegionInfo; dir?: ProviderDirectory } = {},
) =>
  buildTitleWatch(
    {
      store: store as never,
      checkedAt: opts.checkedAt === undefined ? ago(1) : opts.checkedAt,
    },
    opts.region ?? US,
    TITLE,
    NOW,
    opts.dir ?? DIR,
  );

beforeEach(() => {
  resetContainer();
  resetDemoStoreSingleton();
  headerJar.region = undefined;
  headerJar.lang = '';
});
afterEach(() => vi.restoreAllMocks());

describe('buildTitleWatch: hide rules (W4-AC2)', () => {
  it('null when never fetched, no store, older than 30 days, invalid date or degraded catalog', () => {
    const store = { US: { s: [8] } };
    expect(build(store, { checkedAt: null })).toBeNull();
    expect(build(null)).toBeNull();
    expect(build([1])).toBeNull();
    expect(build(store, { checkedAt: ago(30.01) })).toBeNull();
    expect(build(store, { checkedAt: 'yesterday' })).toBeNull();
    expect(build(store, { checkedAt: ago(29.9) })).not.toBeNull();
    expect(
      buildTitleWatch({ store, checkedAt: ago(1) }, US, TITLE, NOW, DIR, { degraded: 'catalog' }),
    ).toBeNull();
    expect(buildTitleWatch(undefined, US, TITLE, NOW, DIR)).toBeNull();
    expect(isWatchFresh(ago(30), NOW)).toBe(true);
  });

  it('region absent → status none, no groups, All options still there (W4-AC1)', () => {
    const w = build({ GB: { s: [8] } })!;
    expect(w).toMatchObject({
      region: 'US',
      regionName: 'United States',
      status: 'none',
      groups: [],
      allOptionsHref: 'https://www.themoviedb.org/movie/693134/watch?locale=US',
      checkedAt: ago(1),
    });
  });

  it('ids that are all unknown → null (never "not streaming" by mistake); some unknown → skipped', () => {
    expect(build({ US: { s: [9999] } })).toBeNull();
    const w = build({ US: { s: [9999, 8] } })!;
    expect(w.groups[0]!.providers.map((p) => p.providerId)).toEqual([8]);
  });
});

describe('buildTitleWatch: groups (W1-AC1/AC2)', () => {
  it('fixed order stream, free, ads, rent, buy; empty groups dropped; stored order kept', () => {
    const w = build({ US: { b: [10], a: [73], s: [337, 8], f: [], r: [2] } })!;
    expect(w.status).toBe('available');
    expect(w.groups.map((g) => g.type)).toEqual(['stream', 'ads', 'rent', 'buy']);
    expect(w.groups[0]!.providers.map((p) => p.providerId)).toEqual([337, 8]);
  });

  it('rent ∩ buy stays in rent with alsoBuy and leaves buy', () => {
    const w = build({ US: { r: [2, 10], b: [2, 3] } })!;
    expect(w.groups.map((g) => g.type)).toEqual(['rent', 'buy']);
    expect(w.groups[0]!.providers).toEqual([
      expect.objectContaining({ providerId: 2, alsoBuy: true }),
      expect.not.objectContaining({ alsoBuy: true }),
    ]);
    expect(w.groups[1]!.providers.map((p) => p.providerId)).toEqual([3]);
  });

  it('every rent provider also sells → one rent_buy group, flags cleared, buy keeps the rest', () => {
    const w = build({ US: { r: [2, 3], b: [2, 3, 10] } })!;
    expect(w.groups.map((g) => g.type)).toEqual(['rent_buy', 'buy']);
    expect(w.groups[0]!.providers.every((p) => p.alsoBuy === undefined)).toBe(true);
    expect(w.groups[1]!.providers.map((p) => p.providerId)).toEqual([10]);
    const only = build({ US: { r: [2], b: [2] } })!;
    expect(only.groups.map((g) => g.type)).toEqual(['rent_buy']);
  });

  it('tolerates malformed stored lists (non-array, bad ids, duplicates)', () => {
    const w = build({ US: { s: [8, 8, -1, 'x', 1.5], f: 'no', r: null } })!;
    expect(w.groups).toHaveLength(1);
    expect(w.groups[0]!.providers.map((p) => p.providerId)).toEqual([8]);
  });
});

describe('buildTitleWatch: tiles and links (W2, ADR-012 §6.3)', () => {
  it('the store is region-agnostic: the same row answers per region', () => {
    const store = { US: { s: [8] }, GB: { f: [38] } };
    expect(build(store, { region: GB })!.groups).toEqual([
      expect.objectContaining({ type: 'free' }),
    ]);
    expect(build(store, { region: regionInfo('IN', 'query', CFG) })!.status).toBe('none');
  });

  it('builds each tile from provider-links, never from upstream data', () => {
    const w = build({ US: { s: [8, 337, 555] } })!;
    const [netflix, disney, other] = w.groups[0]!.providers;
    expect(netflix).toEqual({
      providerId: 8,
      name: 'Netflix',
      logoPath: '/n.jpg',
      monogram: 'N',
      tile: '#b20710',
      href: 'https://www.netflix.com/search?q=Dune%3A%20Part%20Two',
      linkKind: 'search',
    });
    expect(disney).toMatchObject({ href: 'https://www.disneyplus.com/', linkKind: 'home' });
    expect(other).toMatchObject({
      href: 'https://www.themoviedb.org/movie/693134/watch?locale=US',
      linkKind: 'tmdb',
      monogram: 'U',
      tile: null,
    });
  });

  it('region info passes through (fallback flag for an unsupported request, W3-AC4)', () => {
    const fb = regionInfo('JP', 'accept_language', CFG);
    const w = build({ US: { s: [8] } }, { region: fb })!;
    expect(w).toMatchObject({ region: 'US', requested: 'JP', fallback: true });
  });
});

describe('demo fixtures (W6, ADR-012 §8)', () => {
  const keys = new Set(catalog.titles.map((t) => t.key));
  const count = (s: string) =>
    fixtures.titles.filter((t) => t.scenario.includes(s as never)).length;
  const providerIds = new Set(fixtures.providers.map((p) => p.id));

  it('20 catalogue titles × US/GB/IN only, dated 2026-09 and labelled as demo data', () => {
    expect(fixtures.titles).toHaveLength(20);
    expect(new Set(fixtures.titles.map((t) => t.key)).size).toBe(20);
    for (const t of fixtures.titles) {
      expect(keys.has(t.key)).toBe(true);
      for (const r of Object.keys(t.watch)) expect(['US', 'GB', 'IN']).toContain(r);
      for (const lists of Object.values(t.watch))
        for (const ids of Object.values(lists ?? {}))
          for (const id of ids ?? []) expect(providerIds.has(id)).toBe(true);
    }
    expect(fixtures.asOf).toBe('2026-09');
    expect(fixtures.note).toMatch(/demo data, not live/i);
  });

  it('every required scenario (W6-AC2)', () => {
    expect(count('subscription')).toBeGreaterThanOrEqual(8);
    expect(count('free_or_ads')).toBeGreaterThanOrEqual(2);
    expect(count('rent_buy_only')).toBeGreaterThanOrEqual(2);
    expect(count('tv')).toBeGreaterThanOrEqual(5);
    for (const s of ['many', 'none_us', 'stale', 'differs_us_in'])
      expect(count(s)).toBeGreaterThan(0);
    const t = (s: string) => fixtures.titles.filter((x) => x.scenario.includes(s as never));
    // subscription = a major service (Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu, JioHotstar)
    const major = new Set([8, 9, 119, 337, 1899, 350, 15, 2336]);
    for (const x of t('subscription'))
      expect(Object.values(x.watch).some((r) => r?.s?.some((id) => major.has(id)))).toBe(true);
    for (const x of t('free_or_ads'))
      expect(Object.values(x.watch).some((r) => [...(r?.a ?? []), ...(r?.f ?? [])].length)).toBe(
        true,
      );
    for (const x of t('rent_buy_only'))
      for (const r of Object.values(x.watch)) expect(r?.s ?? []).toEqual([]);
    for (const x of t('none_us')) {
      expect(x.watch.US).toBeUndefined();
      expect(x.watch.GB).toBeDefined();
    }
    for (const x of t('stale')) expect(x.ageDays).toBe(45);
    for (const x of t('differs_us_in'))
      expect(JSON.stringify(x.watch.US)).not.toBe(JSON.stringify(x.watch.IN));
    expect(t('tv').every((x) => x.key.startsWith('tv:'))).toBe(true);
    for (const x of fixtures.titles.filter((y) => !y.scenario.includes('stale')))
      expect(x.ageDays).toBeLessThan(30);
  });

  it('demo providers carry monogram tiles only (no logo fetched, W6-AC3)', () => {
    for (const p of fixtures.providers) {
      expect([...p.monogram].length).toBeLessThanOrEqual(2);
      expect(p.tile).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('dal (demo): TitleDetail.watch + getWatchRegion', () => {
  it('getTitle builds the block for the default region; every link is safe', async () => {
    const t = await dal.getTitle('tv', 1396);
    expect(t!.watch).toMatchObject({ region: 'US', status: 'available', source: 'default' });
    for (const g of t!.watch!.groups)
      for (const p of g.providers) {
        expect(p.logoPath).toBeNull();
        const u = new URL(p.href);
        expect(u.protocol).toBe('https:');
        expect(PROVIDER_LINK_HOSTS.has(u.host) || u.host === 'www.themoviedb.org').toBe(true);
      }
  });

  it('getTitle(…, { region }) switches region; "many" has > 6 in one group', async () => {
    const gb = await dal.getTitle('movie', 693134, { region: GB });
    expect(gb!.watch!.groups[0]!.providers[0]!.name).toBe('NOW');
    const many = await dal.getTitle('movie', 157336);
    expect(Math.max(...many!.watch!.groups.map((g) => g.providers.length))).toBeGreaterThan(6);
  });

  it('none_us → status none in US, available in GB; stale → null; not in the file → null', async () => {
    expect((await dal.getTitle('tv', 67070))!.watch).toMatchObject({ status: 'none', groups: [] });
    expect((await dal.getTitle('tv', 67070, { region: GB }))!.watch!.status).toBe('available');
    expect((await dal.getTitle('movie', 496243))!.watch).toBeNull();
    expect((await dal.getTitle('movie', 278))!.watch).toBeNull();
  });

  it('checkedAt = now − ageDays (fresh forever, relative)', async () => {
    const t = await dal.getTitle('tv', 66732); // ageDays 0
    expect(Math.abs(Date.parse(t!.watch!.checkedAt) - Date.now())).toBeLessThan(60_000);
  });

  it('provider directory failure hides the block and never fails the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(container().watchProviders, 'all').mockRejectedValue(new Error('down'));
    const t = await dal.getTitle('tv', 1396);
    expect(t).not.toBeNull();
    expect(t!.watch).toBeNull();
  });

  it('degraded catalog (last-good copy) → watch null', async () => {
    await dal.getTitle('tv', 1396); // fills the last-good LRU
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(container().catalog, 'getEntry').mockRejectedValue(
      new AppError('internal', 'Something went wrong. Try again.'),
    );
    const t = await dal.getTitle('tv', 1396);
    expect(t!.degraded).toBe('catalog');
    expect(t!.watch).toBeNull();
  });

  it('getWatchRegion: cookie > Accept-Language > default; never the session', async () => {
    expect(await dal.getWatchRegion()).toMatchObject({ region: 'US', source: 'default' });
    headerJar.lang = 'en-GB,en;q=0.8';
    expect(await dal.getWatchRegion()).toMatchObject({ region: 'GB', source: 'accept_language' });
    headerJar.region = 'IN';
    expect(await dal.getWatchRegion()).toMatchObject({ region: 'IN', source: 'setting' });
    const spy = vi.spyOn(container().auth, 'getSession');
    await dal.getWatchRegion();
    expect(spy).not.toHaveBeenCalled();
  });

  it('titleWatchFor: undefined for unknown titles, block for known ones', async () => {
    expect(await titleWatchFor('movie', 1, US)).toBeUndefined();
    expect((await titleWatchFor('tv', 95396, GB))!.groups[0]!.providers[0]!.name).toBe('Apple TV+');
  });
});

describe('live repositories (fake Supabase client)', () => {
  it('rowToWatch: non-object or missing columns = never fetched', () => {
    const base = {} as CatalogRow;
    expect(rowToWatch(base)).toEqual({ store: null, checkedAt: null });
    expect(
      rowToWatch({ ...base, watch: { US: { s: [8] } }, watch_checked_at: '2026-09-01T00:00:00Z' }),
    ).toEqual({ store: { US: { s: [8] } }, checkedAt: '2026-09-01T00:00:00Z' });
    expect(rowToWatch({ ...base, watch: [1], watch_checked_at: null }).store).toBeNull();
  });

  it('SupabaseWatchProviders: one query per hour; a failed refresh keeps the last good map', async () => {
    let now = 0;
    let fail = false;
    const select = vi.fn(async () =>
      fail
        ? { data: null, error: { code: 'XX', message: 'down' } }
        : { data: [{ provider_id: 8, name: 'Netflix', logo_path: '/n.jpg' }], error: null },
    );
    const client = { from: () => ({ select }) } as unknown as SupabaseClient;
    const repo = new SupabaseWatchProviders(
      () => client,
      () => now,
    );
    expect((await repo.all()).get(8)).toEqual({ name: 'Netflix', logoPath: '/n.jpg' });
    await repo.all();
    expect(select).toHaveBeenCalledTimes(1);
    now = 3_600_001;
    fail = true;
    expect((await repo.all()).get(8)?.name).toBe('Netflix');
    expect(select).toHaveBeenCalledTimes(2);
    const empty = new SupabaseWatchProviders(
      () => client,
      () => 0,
    );
    await expect(empty.all()).rejects.toBeInstanceOf(AppError);
  });

  it('SupabaseSettings: reads the own row, writes through the invoker RPC', async () => {
    const rpc = vi.fn(async () => ({ data: 'GB', error: null }));
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { watch_region: 'GB' }, error: null }) }),
        }),
      }),
      rpc,
    } as unknown as SupabaseClient;
    const repo = new SupabaseSettings({ user: () => client });
    expect(await repo.get('u1')).toEqual({ watchRegion: 'GB' });
    await repo.setWatchRegion('u1', null);
    expect(rpc).toHaveBeenCalledWith('user_settings_set_watch_region', { p_region: null });
  });
});
