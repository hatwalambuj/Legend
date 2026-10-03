/** ADR-013 close-out units: watchHintFor (C-01), log/redact + onRequestError (C-13), og-assets (C-08),
 * matcher (C-11), enrich core mapping (C-06), events aggregation (C-09), sync-runner retention. */
import { describe, expect, it, vi } from 'vitest';
import { mapTmdbCore } from '@/server/jobs/enrich';
import { runSync, type SyncSteps } from '@/server/jobs/sync-runner';
import { aggregate, analyticsEnabled } from '@/server/events';
import { buildMatchIndex, matchItemOf, matchOne } from '@/server/imports/match';
import { importKey, importMaxRowsPerDay } from '@/server/imports/commit';
import { log, redact, redactString, release, stripQuery, uaFamily } from '@/server/log';
import { loadOgFonts, loadPosterDataUrl, resetOgFonts } from '@/server/og-assets';
import { isProfileShareable } from '@/server/share';
import { watchHasProvider, watchHintFor, type ProviderDirectory } from '@/server/watch';
import { onRequestError } from '@/instrumentation';
import type { TitleSummary } from '@/lib/types';

const NOW = new Date('2026-10-03T12:00:00Z');
const fresh = '2026-10-01T00:00:00Z';
const dir: ProviderDirectory = new Map([
  [8, { name: 'Netflix', logoPath: '/n.png' }],
  [73, { name: 'Tubi', logoPath: null, monogram: 'T', tile: '#ff0000' }],
  [2, { name: 'Apple TV', logoPath: null }],
]);

describe('watchHintFor (C-01)', () => {
  it('picks the first known s, else f, else a provider; rent/buy never count', () => {
    expect(watchHintFor({ US: { s: [999, 8], a: [73] } }, fresh, 'US', dir, NOW)).toEqual({
      providerId: 8,
      name: 'Netflix',
      logoPath: '/n.png',
      monogram: expect.any(String),
      tile: expect.anything(),
    });
    expect(watchHintFor({ US: { a: [73] } }, fresh, 'US', dir, NOW)).toMatchObject({
      providerId: 73,
      monogram: 'T',
      tile: '#ff0000',
    });
    expect(watchHintFor({ US: { r: [2], b: [2] } }, fresh, 'US', dir, NOW)).toBeNull();
    expect(watchHintFor({ GB: { s: [8] } }, fresh, 'US', dir, NOW)).toBeNull();
  });

  it('stale (> 30 days) or never fetched → null', () => {
    expect(watchHintFor({ US: { s: [8] } }, '2026-08-01T00:00:00Z', 'US', dir, NOW)).toBeNull();
    expect(watchHintFor({ US: { s: [8] } }, null, 'US', dir, NOW)).toBeNull();
    expect(watchHintFor(null, fresh, 'US', dir, NOW)).toBeNull();
  });

  it('watchHasProvider mirrors the SQL filter', () => {
    const w = { store: { US: { f: [73] } }, checkedAt: fresh };
    expect(watchHasProvider(w, 'US', 73, NOW)).toBe(true);
    expect(watchHasProvider(w, 'US', 8, NOW)).toBe(false);
    expect(watchHasProvider({ ...w, checkedAt: '2026-01-01T00:00:00Z' }, 'US', 73, NOW)).toBe(
      false,
    );
  });
});

describe('log + redact (C-13)', () => {
  it('redacts emails, JWTs, sb-* cookies, auth headers, query strings, secret keys and >= 2 KB', () => {
    expect(redactString('mail a.b@c.io now')).toBe('mail [email] now');
    expect(redactString('t=eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl')).toBe('t=[token]');
    expect(redactString('cookie sb-abc-auth-token=xyz; other=1')).toBe(
      'cookie sb-abc-auth-token=[redacted]; other=1',
    );
    expect(redactString('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [redacted]');
    expect(redactString('GET https://x.test/a/b?token=1&x=2 done')).toBe(
      'GET https://x.test/a/b done',
    );
    expect(redactString('/title/movie/1?region=GB')).toBe('/title/movie/1');
    expect(redactString('x'.repeat(2048))).toBe('[omitted: too long]');
    expect(redact({ authorization: 'abc', nested: { password: 'p', ok: 1 } })).toEqual({
      authorization: '[redacted]',
      nested: { password: '[redacted]', ok: 1 },
    });
    expect(redact(new Error('for a@b.co'))).toEqual({ name: 'Error', message: 'for [email]' });
    expect(stripQuery('/a/b?c=1#d')).toBe('/a/b');
    expect(release({ VERCEL_GIT_COMMIT_SHA: 'abcdef123456' })).toBe('abcdef1');
    expect(release({})).toBe('dev');
    expect(uaFamily('Mozilla/5.0 (Macintosh) AppleWebKit Version/17.0 Safari/605')).toBe('safari');
    expect(uaFamily('Mozilla/5.0 Firefox/120.0')).toBe('firefox');
    expect(uaFamily('Mozilla/5.0 Chrome/120 Safari/537 Edg/120')).toBe('edge');
    expect(uaFamily(null)).toBe('other');
  });

  it('writes one JSON line with ts, level, event, release', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('thing_happened', { user: 'a@b.co', n: 2 });
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    spy.mockRestore();
    expect(line).toMatchObject({
      level: 'warn',
      event: 'thing_happened',
      release: 'dev',
      user: '[email]',
      n: 2,
    });
    expect(typeof line.ts).toBe('string');
  });

  it('onRequestError logs route path, type, digest and message — never the URL, headers or body', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('db exploded for a@b.co'), { digest: 'D123' });
    await onRequestError(
      err,
      {
        path: '/title/movie/1-x?secret=1',
        method: 'GET',
        headers: { cookie: 'sb-x-auth-token=abc' },
      },
      {
        routerKind: 'App Router',
        routePath: '/title/[type]/[slug]',
        routeType: 'render',
        renderSource: 'server-rendering',
        revalidateReason: undefined,
      },
    );
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    spy.mockRestore();
    expect(line).toMatchObject({
      event: 'request_error',
      routePath: '/title/[type]/[slug]',
      routeType: 'render',
      digest: 'D123',
      message: 'db exploded for [email]',
    });
    expect(JSON.stringify(line)).not.toMatch(/secret|sb-x|cookie/);
  });
});

describe('og-assets (C-08)', () => {
  it('loads Geist once from src/og/fonts', async () => {
    resetOgFonts();
    const fonts = await loadOgFonts();
    expect(fonts[0]).toMatchObject({ name: 'Geist', weight: 400, style: 'normal' });
    expect(fonts[0]!.data.byteLength).toBeGreaterThan(50_000);
    expect(await loadOgFonts()).toBe(fonts);
  });

  it('never fetches in demo mode or with images off; live failures → null', async () => {
    const f = vi.fn(async () => new Response('x'));
    expect(await loadPosterDataUrl('/p.jpg', { isDemo: true, images: 'tmdb' }, f)).toBeNull();
    expect(await loadPosterDataUrl('/p.jpg', { isDemo: false, images: 'off' }, f)).toBeNull();
    expect(await loadPosterDataUrl(null, { isDemo: false, images: 'tmdb' }, f)).toBeNull();
    expect(await loadPosterDataUrl('/../x.jpg', { isDemo: false, images: 'tmdb' }, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    const live = { isDemo: false, images: 'tmdb' as const };
    const ok = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
    );
    expect(await loadPosterDataUrl('/p.jpg', live, ok)).toBe('data:image/jpeg;base64,AQID');
    expect(ok).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w500/p.jpg', expect.anything());
    const html = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
    expect(await loadPosterDataUrl('/p.jpg', live, html)).toBeNull();
    const huge = async () =>
      new Response(new Uint8Array(1.6 * 1024 * 1024), { headers: { 'content-type': 'image/png' } });
    expect(await loadPosterDataUrl('/p.png', live, huge)).toBeNull();
    const boom = async () => {
      throw new Error('timeout');
    };
    expect(await loadPosterDataUrl('/p.jpg', live, boom)).toBeNull();
  });

  it('every existing profile is shareable today', () => {
    expect(
      isProfileShareable({
        id: 'u',
        handle: 'h',
        displayName: 'H',
        bio: '',
        avatarUrl: null,
        createdAt: '',
      }),
    ).toBe(true);
    expect(isProfileShareable(null)).toBe(false);
  });
});

describe('import matcher (C-11)', () => {
  const t = (
    key: string,
    title: string,
    year: number,
    voteCount: number,
    imdbId: string | null = null,
  ) =>
    ({
      key,
      mediaType: key.split(':')[0],
      tmdbId: Number(key.split(':')[1]),
      title,
      originalTitle: title,
      year,
      voteCount,
      imdbId,
    }) as unknown as TitleSummary;
  const idx = buildMatchIndex([
    t('movie:1', 'Solaris', 1972, 900, 'tt0069293'),
    t('movie:2', 'Solaris', 2002, 1200),
    t('tv:3', 'Solaris', 2002, 5000),
  ]);

  it('tmdbId+type → imdbId → title + year ±1 + type, highest vote_count', () => {
    expect(matchOne(idx, { ref: 'a', mediaType: 'movie', tmdbId: 1 })?.key).toBe('movie:1');
    expect(matchOne(idx, { ref: 'b', imdbId: 'tt0069293' })?.key).toBe('movie:1');
    expect(
      matchOne(idx, { ref: 'c', titleNorm: 'solaris', year: 1973, mediaType: 'movie' })?.key,
    ).toBe('movie:1');
    expect(matchOne(idx, { ref: 'd', titleNorm: 'solaris', year: 2003 })?.key).toBe('tv:3');
    expect(matchOne(idx, { ref: 'e', titleNorm: 'solaris', year: 1990 })).toBeNull();
    expect(matchItemOf({ ref: 'x', title: 'Shōgun!' })).toEqual({ ref: 'x', titleNorm: 'shogun' });
  });

  it('import keys are stable sha256 hex; the daily budget env is clamped', () => {
    const k = importKey('letterboxd', 'movie:1', '2024-01-01', null, 0);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(importKey('letterboxd', 'movie:1', '2024-01-01', null, 0)).toBe(k);
    expect(importKey('letterboxd', 'movie:1', '2024-01-01', null, 1)).not.toBe(k);
    expect(importMaxRowsPerDay({})).toBe(20_000);
    expect(importMaxRowsPerDay({ IMPORT_MAX_ROWS_PER_DAY: '500' })).toBe(500);
    expect(importMaxRowsPerDay({ IMPORT_MAX_ROWS_PER_DAY: '999999' })).toBe(20_000);
  });
});

describe('enrich core mapping (C-06)', () => {
  it('maps the TMDB detail body like discover does', () => {
    const core = mapTmdbCore('tv', {
      name: 'Shōgun',
      original_name: 'Shōgun',
      overview: 'A  long\n overview.',
      first_air_date: '2024-02-27',
      vote_average: 8.66,
      vote_count: 1200,
      popularity: 55.5,
      poster_path: '/p.jpg',
      backdrop_path: 'bad path',
      genres: [{ id: 18, name: 'Drama' }, { id: 'x' }],
    });
    expect(core).toEqual({
      title: 'Shōgun',
      original_title: 'Shōgun',
      slug: 'shogun',
      sort_title: 'shogun',
      search_text: 'shogun shogun',
      overview_short: 'A long overview.',
      release_date: '2024-02-27',
      vote_average: 8.7,
      vote_count: 1200,
      popularity: 55.5,
      poster_path: '/p.jpg',
      backdrop_path: null,
      genre_ids: [18],
      genres: [{ id: 18, name: 'Drama' }],
    });
    expect(mapTmdbCore('movie', { overview: 'no title' })).toBeNull();
  });
});

describe('events (C-09)', () => {
  it('aggregates duplicates and drops unknown names / bad dims', () => {
    expect(
      aggregate([
        { name: 'stub_created', dim: '' },
        { name: 'stub_created', dim: '' },
        { name: 'review_saved', dim: 'new' },
        { name: 'review_saved', dim: 'bogus' },
        { name: 'pageview', dim: '' },
      ]),
    ).toEqual([
      { name: 'stub_created', dim: '', n: 2 },
      { name: 'review_saved', dim: 'new', n: 1 },
    ]);
    expect(analyticsEnabled({})).toBe(true);
    expect(analyticsEnabled({ ANALYTICS_ENABLED: 'false' })).toBe(false);
  });

  it('the nightly job purges old counters on full non-dry runs only', async () => {
    const eventsPurge = vi.fn(async () => 3);
    const steps: SyncSteps = {
      startRun: async () => undefined,
      finishRun: async () => undefined,
      discover: async () => ({ counts: {}, wrote: 0 }),
      enrich: async () => ({ counts: {}, wrote: 0 }),
      watch: async () => ({ counts: {}, wrote: 0 }),
      imdb: async () => ({ counts: {}, wrote: 0 }),
      palettes: async () => ({ counts: {}, wrote: 0 }),
      disagreements: async () => [],
      purge: async () => ({}),
      eventsPurge,
      revalidate: async () => undefined,
    };
    expect((await runSync(steps, { dryRun: false, only: null })).counts.events_purge).toBe(3);
    await runSync(steps, { dryRun: true, only: null });
    await runSync(steps, { dryRun: false, only: 'imdb' });
    expect(eventsPurge).toHaveBeenCalledTimes(1);
  });
});
