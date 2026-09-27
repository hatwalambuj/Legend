/** ADR-012 §5 / PRD W3: region resolution order, normalisation, trusted geo header, env validation. */
import { describe, expect, it } from 'vitest';
import { memoryCookieJar } from '@/server/auth/cookies';
import { EnvError, parseEnv, parseWatchConfig } from '@/server/env';
import {
  WATCH_REGION_COOKIE,
  acceptLanguageRegion,
  cookieRegion,
  regionInfo,
  resolveWatchRegion,
  watchRegionConfig,
  writeRegionCookie,
  type RegionConfig,
} from './region';

const CFG: RegionConfig = {
  defaultRegion: 'US',
  regions: ['US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'ES', 'BR', 'MX'],
  geoHeader: null,
};
const GEO: RegionConfig = { ...CFG, geoHeader: 'cf-ipcountry' };

describe('acceptLanguageRegion (W3-AC1)', () => {
  it.each([
    ['en-GB,en;q=0.8', 'GB'],
    ['hi-IN', 'IN'],
    ['zh-Hant-TW', 'TW'],
    ['en', null],
    ['es-419', null],
    ['*', null],
    ['', null],
    [null, null],
    ['en;q=0.5, fr-FR;q=0.9', 'FR'],
    ['de-DE;q=0.2, en-US;q=0.2', 'DE'], // stable on equal q
    ['fr-FR;q=0, en-GB', 'GB'], // q=0 = not acceptable
    ['en-uk', 'GB'],
    ['sr-Latn-RS', 'RS'],
    ['x-klingon-GB', null],
  ])('%j → %j', (h, want) => expect(acceptLanguageRegion(h)).toBe(want));

  it('reads at most 10 entries', () => {
    const h = [...Array(10).fill('en'), 'en-GB'].join(',');
    expect(acceptLanguageRegion(h)).toBeNull();
  });
});

describe('resolveWatchRegion', () => {
  it('no input → the default, not a fallback', () => {
    expect(resolveWatchRegion({}, CFG)).toEqual({
      region: 'US',
      regionName: 'United States',
      requested: null,
      fallback: false,
      source: 'default',
    });
  });

  it('query > cookie > geo > Accept-Language', () => {
    const all = { query: 'in', cookie: 'GB', geo: 'DE', acceptLanguage: 'fr-FR' };
    expect(resolveWatchRegion(all, GEO)).toMatchObject({ region: 'IN', source: 'query' });
    expect(resolveWatchRegion({ ...all, query: null }, GEO)).toMatchObject({
      region: 'GB',
      source: 'setting',
    });
    expect(resolveWatchRegion({ ...all, query: null, cookie: null }, GEO)).toMatchObject({
      region: 'DE',
      source: 'geo',
    });
    expect(resolveWatchRegion({ ...all, query: null, cookie: null, geo: null }, GEO)).toMatchObject(
      { region: 'FR', source: 'accept_language' },
    );
  });

  it('UK → GB everywhere a code is parsed', () => {
    expect(resolveWatchRegion({ query: 'uk' }, CFG).region).toBe('GB');
    expect(resolveWatchRegion({ geo: 'UK' }, GEO).region).toBe('GB');
  });

  it('a spoofed geo header is ignored when the header is not trusted (W3-AC2)', () => {
    expect(resolveWatchRegion({ geo: 'GB', acceptLanguage: 'en' }, CFG)).toMatchObject({
      region: 'US',
      source: 'default',
    });
  });

  it('geo placeholders are absent', () => {
    for (const v of ['XX', 'T1', 'A1', 'A2', 'EU', 'AP'])
      expect(resolveWatchRegion({ geo: v, acceptLanguage: 'hi-IN' }, GEO).source).toBe(
        'accept_language',
      );
  });

  it('a malformed cookie is ignored (only ^[A-Z]{2}$ is ours)', () => {
    for (const c of ['gb', 'GBR', 'G', '"><', ''])
      expect(resolveWatchRegion({ cookie: c }, CFG).source).toBe('default');
    expect(cookieRegion('GB')).toBe('GB');
  });

  it('unsupported region → default with fallback and the requested code (W3-AC4)', () => {
    expect(resolveWatchRegion({ acceptLanguage: 'ja-JP' }, CFG)).toEqual({
      region: 'US',
      regionName: 'United States',
      requested: 'JP',
      fallback: true,
      source: 'accept_language',
    });
    expect(regionInfo('ZZ', 'query', CFG)).toMatchObject({ region: 'US', fallback: true });
  });
});

describe('watchRegionConfig: geo only behind a trusted proxy', () => {
  const base = { CATALOG_MODE: 'fixtures', DATA_MODE: 'local' };
  it('WATCH_GEO_HEADER without TRUSTED_PROXY → ignored', () => {
    const e = parseEnv({ ...base, WATCH_GEO_HEADER: 'CF-IPCountry' });
    expect(e.watch.geoHeader).toBe('cf-ipcountry');
    expect(watchRegionConfig(e).geoHeader).toBeNull();
  });
  it('with TRUSTED_PROXY=cloudflare → honoured', () => {
    const e = parseEnv({ ...base, WATCH_GEO_HEADER: 'cf-ipcountry', TRUSTED_PROXY: 'cloudflare' });
    expect(watchRegionConfig(e).geoHeader).toBe('cf-ipcountry');
  });
  it('TRUSTED_PROXY=none → ignored even when set', () => {
    const e = parseEnv({ ...base, WATCH_GEO_HEADER: 'cf-ipcountry', TRUSTED_PROXY: 'none' });
    expect(watchRegionConfig(e).geoHeader).toBeNull();
  });
});

describe('env: WATCH_* validation (ADR-012 §5, W8-AC1)', () => {
  it('zero env → US + the 10 default regions, names for the <select>', () => {
    const e = parseEnv({});
    expect(e.watch).toEqual({
      defaultRegion: 'US',
      regions: ['US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'ES', 'BR', 'MX'],
      geoHeader: null,
      sync: { max: 3000, ttlDays: 7, hotDays: 1 },
    });
    expect(e.mode.watchRegions?.[1]).toEqual({ code: 'GB', name: 'United Kingdom' });
    expect(parseEnv({ SYNC_WATCH_MAX: '10', SYNC_WATCH_HOT_DAYS: '0' }).watch.sync).toEqual({
      max: 10,
      ttlDays: 7,
      hotDays: 0,
    });
  });

  it('normalises and dedupes the list', () => {
    expect(parseWatchConfig('gb', 'us, uk ,GB,in', undefined)).toEqual({
      defaultRegion: 'GB',
      regions: ['US', 'GB', 'IN'],
      geoHeader: null,
    });
  });

  it.each([
    [undefined, 'US,QQ', undefined, /WATCH_REGIONS/],
    [undefined, 'US,GBR', undefined, /WATCH_REGIONS/],
    ['DE', 'US,GB', undefined, /must be one of WATCH_REGIONS/],
    ['XX', undefined, undefined, /WATCH_REGION_DEFAULT/],
    [undefined, undefined, 'bad header!', /WATCH_GEO_HEADER/],
  ])('fails the boot clearly (%s, %s, %s)', (d, r, g, msg) => {
    expect(() => parseWatchConfig(d, r, g)).toThrow(EnvError);
    expect(() => parseWatchConfig(d, r, g)).toThrow(msg);
  });
});

describe('writeRegionCookie', () => {
  it('sets a valid code and clears on null', () => {
    const jar = memoryCookieJar();
    writeRegionCookie(jar, 'GB');
    expect(jar.values.get(WATCH_REGION_COOKIE)).toBe('GB');
    writeRegionCookie(jar, null);
    expect(jar.values.has(WATCH_REGION_COOKIE)).toBe(false);
    writeRegionCookie(jar, 'gb; Path=/evil');
    expect(jar.values.has(WATCH_REGION_COOKIE)).toBe(false);
  });
});
