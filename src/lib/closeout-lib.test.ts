// @vitest-environment jsdom
/** C-00 shared helpers (ADR-013): brand, share, avatar, routes, analytics queue, client error reports. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_EVENTS,
  eventDim,
  flushEvents,
  isValidDim,
  resetAnalyticsForTests,
  trackEvent,
} from './analytics';
import { AVATAR_COLORS, isAvatarColor } from './avatar';
import { BRAND_NAME, brandName, DEFAULT_BRAND_NAME } from './brand';
import {
  catalogQuerySchema,
  createStubSchema,
  importCommitSchema,
  signUpSchema,
  trackEventsSchema,
  updateProfileSchema,
  updateStubSchema,
} from './contracts';
import { ERROR_STATUS } from './errors';
import { reportError, resetReportErrorForTests } from './report-error';
import { browseHref, importHref, shareStubHref, storyHref } from './routes';
import { shareData } from './share';

const dune = {
  mediaType: 'movie' as const,
  tmdbId: 693134,
  slug: 'dune-part-two',
  title: 'Dune: Part Two',
  year: 2024,
};

describe('brand (C-15)', () => {
  it('accepts a short plain name and falls back on anything else', () => {
    expect(brandName(' Reel ')).toBe('Reel');
    expect(brandName("Ciné & Co's")).toBe("Ciné & Co's");
    expect(brandName('')).toBe(DEFAULT_BRAND_NAME);
    expect(brandName(undefined)).toBe(DEFAULT_BRAND_NAME);
    expect(brandName('<script>')).toBe(DEFAULT_BRAND_NAME);
    expect(brandName('x'.repeat(25))).toBe(DEFAULT_BRAND_NAME);
    expect(BRAND_NAME).toBe('Stubbed');
  });
});

describe('shareData (C-07)', () => {
  const site = 'https://stubbed.example/';
  it('builds absolute ?ref=share URLs; review URLs point at the title page', () => {
    expect(shareData({ kind: 'title', title: dune }, site).url).toBe(
      'https://stubbed.example/title/movie/693134-dune-part-two?ref=share',
    );
    const r = shareData({ kind: 'review', title: dune, rating10: 8 }, site);
    expect(r.url).toBe('https://stubbed.example/title/movie/693134-dune-part-two?ref=share');
    expect(r.text).toBe('Dune: Part Two (2024): 8/10 on Stubbed');
    expect(shareData({ kind: 'wallet', handle: 'maya', displayName: 'Maya' }, site).url).toBe(
      'https://stubbed.example/u/maya?ref=share',
    );
    expect(shareData({ kind: 'stub', stubId: 'abc', title: dune }, site).url).toBe(
      'https://stubbed.example/share/stub/abc?ref=share',
    );
  });

  it('never carries a review body or a note (the target has none to give)', () => {
    const r = shareData(
      // Extra fields a caller might pass by mistake are ignored.
      { kind: 'review', title: { ...dune, body: 'SPOILER' } as typeof dune, rating10: 7 },
      'https://x.test',
    );
    expect(JSON.stringify(r)).not.toContain('SPOILER');
  });
});

describe('routes + avatar + errors (C-00)', () => {
  it('browseHref keeps provider with type/sort in a stable order', () => {
    expect(browseHref({ type: 'tv', sort: 'rating_desc', provider: 8 })).toBe(
      '/browse?type=tv&sort=rating_desc&provider=8',
    );
    expect(browseHref({ provider: 0 })).toBe('/browse');
    expect(shareStubHref('a b')).toBe('/share/stub/a%20b');
    expect(storyHref('x', { download: true })).toBe('/share/stub/x/story?download=1');
    expect(importHref()).toBe('/me/import');
  });

  it('avatar colours and the 413 code', () => {
    expect(AVATAR_COLORS).toHaveLength(8);
    expect(isAvatarColor('ocean')).toBe(true);
    expect(isAvatarColor('pink')).toBe(false);
    expect(ERROR_STATUS.payload_too_large).toBe(413);
  });
});

describe('contracts v1.6', () => {
  it('provider needs a region; region is normalised', () => {
    expect(catalogQuerySchema.safeParse({ provider: '8' }).success).toBe(false);
    const ok = catalogQuerySchema.parse({ provider: '8', region: 'uk' });
    expect(ok).toMatchObject({ provider: 8, region: 'GB' });
  });

  it('season, avatarColor and ref', () => {
    expect(createStubSchema.safeParse({ mediaType: 'tv', tmdbId: 1, season: 0 }).success).toBe(
      false,
    );
    expect(createStubSchema.parse({ mediaType: 'tv', tmdbId: 1, season: 3 }).season).toBe(3);
    expect(updateStubSchema.parse({ season: null })).toEqual({ season: null });
    expect(updateProfileSchema.safeParse({ avatarColor: 'pink' }).success).toBe(false);
    expect(updateProfileSchema.parse({ avatarColor: null })).toEqual({ avatarColor: null });
    const base = { email: 'a@b.co', password: '12345678', handle: 'abc' };
    expect(signUpSchema.parse({ ...base, ref: 'share' }).ref).toBe('share');
    expect(signUpSchema.parse({ ...base, ref: 'evil' }).ref).toBeUndefined();
  });

  it('trackEventsSchema accepts only client events with a valid dim', () => {
    const ok = { events: [{ name: 'share_generated', dim: 'title:copy' }] };
    expect(trackEventsSchema.safeParse(ok).success).toBe(true);
    expect(
      trackEventsSchema.safeParse({ events: [{ name: 'stub_created', dim: '' }] }).success,
    ).toBe(false);
    expect(
      trackEventsSchema.safeParse({ events: [{ name: 'share_generated', dim: 'free text' }] })
        .success,
    ).toBe(false);
    expect(trackEventsSchema.safeParse({ events: [] }).success).toBe(false);
  });

  it('importCommitSchema validates rows', () => {
    const base = {
      source: 'letterboxd',
      importId: '0a000000-0000-4000-8000-0000000000a1',
      final: true,
      options: { createStubs: true, ratings: true, reviews: true },
    };
    expect(
      importCommitSchema.safeParse({ ...base, rows: [{ ref: 'r1', imdbId: 'tt0000001' }] }).success,
    ).toBe(true);
    expect(
      importCommitSchema.safeParse({ ...base, rows: [{ ref: 'r1', imdbId: 'nm1' }] }).success,
    ).toBe(false);
  });
});

describe('analytics queue (C-09)', () => {
  const beacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
  beforeEach(() => {
    resetAnalyticsForTests();
    beacon.mockClear();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: false, configurable: true });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('every event has a dim rule; dims are validated', () => {
    expect(Object.keys(ANALYTICS_EVENTS)).toHaveLength(12);
    expect(isValidDim('worth_it_viewed', 'widely_loved')).toBe(true);
    expect(isValidDim('worth_it_viewed', 'great')).toBe(false);
    expect(
      eventDim('provider_clicked', {
        provider_id: 8,
        type: 'stream',
        region: 'US',
        link_kind: 'search',
      }),
    ).toBe('stream:US:8:search');
  });

  it('batches events and flushes once after 5 s or on pagehide', async () => {
    trackEvent('share_generated', { surface: 'title', method: 'copy' });
    trackEvent('worth_it_viewed', { verdict: 'well_liked' });
    expect(beacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(beacon).toHaveBeenCalledTimes(1);
    const blob = beacon.mock.calls[0]![1] as Blob;
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual({
      events: [
        { name: 'share_generated', dim: 'title:copy' },
        { name: 'worth_it_viewed', dim: 'well_liked' },
      ],
    });
    trackEvent('share_generated', { surface: 'stub', method: 'story' });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(2);
    flushEvents();
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it('sends nothing under Global Privacy Control', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    trackEvent('share_generated', { surface: 'title', method: 'copy' });
    vi.advanceTimersByTime(6000);
    flushEvents();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('reportError (C-13)', () => {
  it('dedupes by kind+message, caps at 5 per page, sends only the pathname', async () => {
    resetReportErrorForTests();
    const beacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    window.history.replaceState(null, '', '/title/movie/1-x?secret=1#h');
    reportError({ kind: 'unhandled', message: 'boom' });
    reportError({ kind: 'unhandled', message: 'boom' });
    for (let i = 0; i < 10; i++) reportError({ kind: 'rejection', message: `m${i}` });
    expect(beacon).toHaveBeenCalledTimes(5);
    const body = JSON.parse(await (beacon.mock.calls[0]![1] as Blob).text());
    expect(body).toEqual({ kind: 'unhandled', message: 'boom', path: '/title/movie/1-x' });
  });
});
