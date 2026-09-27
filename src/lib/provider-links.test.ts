/**
 * W8-AC2 / ADR-012 §10.1 guard: every configured provider URL (and every regional override) is plain
 * https on an allowlisted host with exactly one `{title}` slot and no affiliate/tracking parameter, and
 * hostile titles can never change the host, the scheme or add a parameter.
 */
import { describe, expect, it } from 'vitest';
import {
  BANNED_QUERY_KEY,
  JUSTWATCH_ATTRIBUTION,
  PROVIDER_LINKS,
  PROVIDER_LINK_HOSTS,
  PROVIDER_LINKS_VERSION,
  isSafeProviderUrl,
  providerHref,
  providerMonogram,
  tmdbWatchHref,
} from './provider-links';

const entries = Object.entries(PROVIDER_LINKS).flatMap(([id, p]) => [
  { id: Number(id), region: null as string | null, e: p },
  ...Object.entries(p.byRegion ?? {}).map(([region, e]) => ({ id: Number(id), region, e: e! })),
]);

const HOSTILE = [
  'a&b',
  'x/../y',
  'https://evil.example/',
  '%00',
  '..',
  '.',
  '   ',
  '',
  'Amélie 🎬',
  '"><script>alert(1)</script>',
  'a?utm_source=x&tag=y#frag',
  'javascript:alert(1)',
  'x'.repeat(500),
];

describe('provider-links config (W8-AC2)', () => {
  it('has a version and a non-empty host allowlist', () => {
    expect(PROVIDER_LINKS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(PROVIDER_LINK_HOSTS.size).toBeGreaterThan(5);
    for (const h of PROVIDER_LINK_HOSTS) expect(h).toMatch(/^[a-z0-9.-]+$/);
  });

  it.each(entries.map((x) => [`${x.id}${x.region ? `/${x.region}` : ''}`, x]))(
    '%s: https, allowlisted host, one {title}, no tracking params',
    (_name, { e }) => {
      for (const url of [e.home, e.search].filter((u): u is string => Boolean(u))) {
        expect(url.startsWith('https://')).toBe(true);
        const u = new URL(url.replace('{title}', 'x'));
        expect(u.protocol).toBe('https:');
        expect(u.username + u.password + u.port).toBe('');
        expect(PROVIDER_LINK_HOSTS.has(u.host)).toBe(true);
        for (const k of u.searchParams.keys()) expect(BANNED_QUERY_KEY.test(k)).toBe(false);
        expect(url).not.toMatch(/utm_|[?&]tag=|affid|[?&]ref=/i);
      }
      expect(e.home).not.toContain('{title}');
      if (e.search) {
        expect(e.search.split('{title}')).toHaveLength(2);
        // The slot is a whole query value or one whole path segment.
        expect(e.search).toMatch(/(=\{title\}(&|$))|(\/\{title\}$)/);
      }
    },
  );

  it('monograms are <= 2 chars and tiles are #rrggbb', () => {
    for (const { e } of entries) {
      if ('monogram' in e && e.monogram) expect([...e.monogram].length).toBeLessThanOrEqual(2);
      if ('tile' in e && e.tile) expect(e.tile).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('providerHref', () => {
  it('fills the search template with the URL-encoded title', () => {
    expect(providerHref(8, 'Dune: Part Two', 'US', 'movie', 693134)).toEqual({
      href: 'https://www.netflix.com/search?q=Dune%3A%20Part%20Two',
      kind: 'search',
    });
    expect(providerHref(73, 'a b', 'US', 'movie', 1).href).toBe('https://tubitv.com/search/a%20b');
  });

  it('uses the homepage when there is no template, and regional storefronts', () => {
    expect(providerHref(337, 'Coco', 'US', 'movie', 354912)).toEqual({
      href: 'https://www.disneyplus.com/',
      kind: 'home',
    });
    expect(providerHref(10, 'Aftersun', 'GB', 'movie', 965150).href).toBe(
      'https://www.amazon.co.uk/',
    );
    expect(providerHref(10, 'Aftersun', 'IN', 'movie', 965150).href).toBe('https://www.amazon.in/');
    expect(providerHref(10, 'Aftersun', 'US', 'movie', 965150).href).toBe(
      'https://www.amazon.com/',
    );
  });

  it('unknown provider → the TMDB watch page', () => {
    expect(providerHref(999999, 'X', 'GB', 'tv', 1396)).toEqual({
      href: 'https://www.themoviedb.org/tv/1396/watch?locale=GB',
      kind: 'tmdb',
    });
  });

  it.each(HOSTILE)('hostile title %j never changes host, scheme or params', (title) => {
    for (const id of Object.keys(PROVIDER_LINKS).map(Number)) {
      for (const region of ['US', 'GB', 'IN']) {
        const { href, kind } = providerHref(id, title, region, 'movie', 550);
        const u = new URL(href);
        expect(u.protocol).toBe('https:');
        if (kind === 'tmdb') expect(u.host).toBe('www.themoviedb.org');
        else expect(PROVIDER_LINK_HOSTS.has(u.host)).toBe(true);
        expect(isSafeProviderUrl(href) || kind === 'tmdb').toBe(true);
        const template = PROVIDER_LINKS[id]!.byRegion?.[region] ?? PROVIDER_LINKS[id]!;
        const base = new URL((template.search ?? template.home).replace('{title}', 'x'));
        // Only the keys of the template itself: a title can't add `utm_…`, `tag` or anything else.
        expect([...u.searchParams.keys()].sort()).toEqual(
          kind === 'search' ? [...base.searchParams.keys()].sort() : [...u.searchParams.keys()],
        );
        if (kind === 'search')
          expect(u.pathname.startsWith(base.pathname.replace(/x$/, ''))).toBe(true);
        expect(href).not.toMatch(/^javascript:/i);
        expect(href.length).toBeLessThan(600);
      }
    }
  });

  it('empty / dot-only titles fall back to the homepage', () => {
    expect(providerHref(73, '..', 'US', 'movie', 1)).toEqual({
      href: 'https://tubitv.com/',
      kind: 'home',
    });
    expect(providerHref(8, '   ', 'US', 'movie', 1).kind).toBe('home');
  });
});

describe('isSafeProviderUrl', () => {
  it.each([
    'http://www.netflix.com/',
    'https://evil.example/',
    'https://www.netflix.com.evil.example/',
    'https://user:pw@www.netflix.com/',
    'https://www.netflix.com:8443/',
    'https://www.netflix.com/?utm_source=x',
    'https://www.amazon.com/?tag=aff-20',
    'https://www.amazon.com/?ref=x',
    'https://www.amazon.com/?ref_=x',
    'https://www.amazon.com/?affid=1',
    'https://www.youtube.com/?gclid=1',
    'https://www.youtube.com/?fbclid=1',
    'nflx://www.netflix.com/title/1',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (href) => expect(isSafeProviderUrl(href)).toBe(false));

  it('accepts the plain homepage', () =>
    expect(isSafeProviderUrl('https://www.hulu.com/')).toBe(true));
});

describe('tmdbWatchHref + attribution', () => {
  it('builds the documented TMDB watch URL, with safe fallbacks for bad input', () => {
    expect(tmdbWatchHref('movie', 550, 'US')).toBe(
      'https://www.themoviedb.org/movie/550/watch?locale=US',
    );
    expect(tmdbWatchHref('tv', 1396, 'gb')).toBe(
      'https://www.themoviedb.org/tv/1396/watch?locale=US',
    );
  });

  it('JustWatch attribution links to justwatch.com without a referrer', () => {
    expect(JUSTWATCH_ATTRIBUTION).toEqual({
      text: 'Data by JustWatch',
      href: 'https://www.justwatch.com/',
      rel: 'noopener noreferrer',
    });
  });

  it('monogram from config, else the first letter of the name', () => {
    expect(providerMonogram(8, 'Netflix')).toEqual({ monogram: 'N', tile: '#b20710' });
    expect(providerMonogram(424242, 'mubi')).toEqual({ monogram: 'M', tile: null });
  });
});
