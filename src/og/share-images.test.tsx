/**
 * Share image routes in demo mode (ADR-013 C-08): PNG sizes from the IHDR bytes, 404s, no Set-Cookie,
 * no fetch at render time (demo = no poster request, palette fallback), the download name.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
  headers: async () => new Headers(),
}));

const story = await import('@/app/share/stub/[id]/story/route');
const stubOg = await import('@/app/share/stub/[id]/opengraph-image/route');
const titleOg = await import('@/app/title/[type]/[slug]/opengraph-image/route');
const titlePage = await import('@/app/title/[type]/[slug]/page');
const stubPage = await import('@/app/share/stub/[id]/page');
const {
  canonicalOgImage,
  canonicalShareSearch,
  SHARE_CACHE_CONTROL,
  shareImageKind,
  shareImageRedirect,
  shareVersion,
} = await import('@/server/share-cache');
const { proxy } = await import('@/proxy');
const { NextRequest } = await import('next/server');
const { ogText, titleTier, watchLine, watchedLabel } = await import('./ShareCard');

const SEED_STUB = '10000000-0000-4000-8000-000000000001';

function pngSize(buf: ArrayBuffer): { width: number; height: number } {
  const v = new DataView(buf);
  expect(v.getUint32(12)).toBe(0x49484452); // "IHDR"
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  // data: URLs are next/og loading its own wasm; any http(s) request would be a network call.
  expect(
    fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => !u.startsWith('data:')),
  ).toEqual([]);
  fetchSpy.mockRestore();
});

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

describe('story route', () => {
  it('renders a 1080×1920 PNG with no cookie and a branded download name', async () => {
    const res = await story.GET(
      new Request(
        `http://localhost/share/stub/${SEED_STUB}/story?v=${shareVersion('story')}&download=1`,
      ),
      params({ id: SEED_STUB }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('public, max-age=600, s-maxage=600');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="stubbed-stub-\d+\.png"$/,
    );
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1080, height: 1920 });
  }, 30_000);

  it('404s an unknown or malformed stub', async () => {
    for (const id of ['0a000000-0000-4000-8000-000000000000', 'nope']) {
      const res = await story.GET(
        new Request(`http://localhost/share/stub/${id}/story?v=${shareVersion('story')}`),
        params({ id }),
      );
      expect(res.status).toBe(404);
    }
  });
});

describe('og images', () => {
  it('stub og is 1200×630', async () => {
    const url = `http://localhost${canonicalOgImage(`/share/stub/${SEED_STUB}`, 'stub_og')}`;
    const res = await stubOg.GET(new Request(url), params({ id: SEED_STUB }));
    expect(res.status).toBe(200);
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it('title og is 1200×630 with the long cache', async () => {
    const url = `http://localhost${canonicalOgImage('/title/movie/693134-dune-part-two', 'title_og')}`;
    const res = await titleOg.GET(
      new Request(url),
      params({ type: 'movie', slug: '693134-dune-part-two' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, s-maxage=31536000, immutable',
    );
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1200, height: 630 });
  }, 30_000);
});

describe('canonical cache keys (R1: query strings cannot force renders)', () => {
  const env = { VERCEL_GIT_COMMIT_SHA: 'abcdef1234' };
  const T = Date.UTC(2026, 9, 4, 12, 0, 0);
  const title = 'http://l/title/movie/693134-dune-part-two/opengraph-image';
  const stub = `http://l/share/stub/${SEED_STUB}`;

  it('classifies only the three image routes', () => {
    expect(shareImageKind('/title/movie/1-x/opengraph-image')).toBe('title_og');
    expect(shareImageKind(`/share/stub/${SEED_STUB}/opengraph-image`)).toBe('stub_og');
    expect(shareImageKind(`/share/stub/${SEED_STUB}/story`)).toBe('story');
    expect(shareImageKind('/title/movie/1-x')).toBeNull();
    expect(shareImageKind(`/share/stub/${SEED_STUB}`)).toBeNull();
  });

  it('versions = release + bucket (1 day for titles, 10 min for stubs)', () => {
    expect(shareVersion('title_og', T, env)).toBe(`abcdef1-${Math.floor(T / 86_400_000)}`);
    expect(shareVersion('story', T, env)).toBe(`abcdef1-${Math.floor(T / 600_000)}`);
    expect(shareVersion('title_og', T + 86_400_000, env)).not.toBe(
      shareVersion('title_og', T, env),
    );
    expect(SHARE_CACHE_CONTROL.title_og).toContain('immutable');
    expect(SHARE_CACHE_CONTROL.stub_og).not.toContain('immutable');
  });

  it('redirects every non-canonical query; the canonical URL passes', () => {
    const v = shareVersion('title_og', T, env);
    for (const q of ['', '?0123456789abcdef', '?x=1', `?v=${v}&x=1`, `?x=1&v=${v}`, '?v=old']) {
      const to = shareImageRedirect(new URL(title + q), T, env);
      expect(to?.toString()).toBe(`${title}?v=${v}`);
    }
    expect(shareImageRedirect(new URL(`${title}?v=${v}`), T, env)).toBeNull();
    // download=1 survives only on the story route, in a fixed position.
    const sv = shareVersion('story', T, env);
    expect(
      shareImageRedirect(new URL(`${stub}/story?download=1&v=${sv}&r=9`), T, env)?.search,
    ).toBe(`?v=${sv}&download=1`);
    expect(shareImageRedirect(new URL(`${stub}/story?v=${sv}&download=1`), T, env)).toBeNull();
    expect(canonicalShareSearch('stub_og', new URLSearchParams('download=1'), T, env)).toBe(
      `?v=${shareVersion('stub_og', T, env)}`,
    );
    expect(shareImageRedirect(new URL('http://l/title/movie/1-x?x=1'), T, env)).toBeNull();
  });

  it('proxy 308s junk params without touching data; the canonical URL goes through', async () => {
    const bust = await proxy(new NextRequest(`${title}?cb=${Math.random()}`));
    expect(bust.status).toBe(308);
    expect(bust.headers.get('location')).toBe(`${title}?v=${shareVersion('title_og')}`);
    const ok = await proxy(new NextRequest(`${title}?v=${shareVersion('title_og')}`));
    expect(ok.headers.get('x-middleware-next')).toBe('1');
  });

  it('page metadata emits exactly the og:image URL the proxy and route serve with 200 (no redirect)', async () => {
    const titleMeta = await titlePage.generateMetadata({
      params: Promise.resolve({ type: 'movie', slug: '693134-dune-part-two' }),
      searchParams: Promise.resolve({}),
    });
    const stubMeta = await stubPage.generateMetadata(params({ id: SEED_STUB }));
    const urls = [titleMeta, stubMeta].map((m) => {
      const imgs = m.openGraph?.images;
      const first = (Array.isArray(imgs) ? imgs[0] : imgs) as { url: string; width: number };
      expect(first.width).toBe(1200);
      return `http://localhost${first.url}`;
    });
    expect(urls[0]).toBe(
      `http://localhost/title/movie/693134-dune-part-two/opengraph-image?v=${shareVersion('title_og')}`,
    );
    expect(urls[1]).toBe(
      `http://localhost/share/stub/${SEED_STUB}/opengraph-image?v=${shareVersion('stub_og')}`,
    );
    for (const u of urls) {
      const res = await proxy(new NextRequest(u));
      expect(res.headers.get('x-middleware-next'), u).toBe('1');
    }
    const og = await stubOg.GET(new Request(urls[1]!), params({ id: SEED_STUB }));
    expect(og.status).toBe(200);
    // Next's own `?<build hash>` convention URL is never emitted; were it requested, it redirects.
    expect(shareImageRedirect(new URL(`${title}?1adcf28b8130d06b`))).not.toBeNull();
  }, 30_000);

  it('accepts the previous bucket (emitted just before a rollover), not older ones', () => {
    const prevV = shareVersion('stub_og', T - 600_000, env);
    const oldV = shareVersion('stub_og', T - 1_200_000, env);
    const og = `${stub}/opengraph-image`;
    expect(shareImageRedirect(new URL(`${og}?v=${prevV}`), T, env)).toBeNull();
    expect(shareImageRedirect(new URL(`${og}?v=${oldV}`), T, env)?.search).toBe(
      `?v=${shareVersion('stub_og', T, env)}`,
    );
  });

  it('the og routes themselves also 308 a non-canonical query before any render', async () => {
    const res = await stubOg.GET(
      new Request(`${stub}/opengraph-image?cb=1`),
      params({ id: SEED_STUB }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    const gone = await stubOg.GET(
      new Request(`http://localhost${canonicalOgImage('/share/stub/nope', 'stub_og')}`),
      params({ id: 'nope' }),
    );
    expect(gone.status).toBe(404);
  });

  it('the story route itself also 308s a non-canonical query before any render', async () => {
    const res = await story.GET(
      new Request(`${stub}/story?download=1&cb=1`),
      params({ id: SEED_STUB }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`${stub}/story?v=${shareVersion('story')}&download=1`);
  });
});

describe('card helpers (SYNTHESIS grafts)', () => {
  it('tiers title sizes by length and clamps long titles', () => {
    expect(titleTier('Dune').size).toBe(56);
    expect(titleTier('Dune: Part Two of Arrakis').size).toBe(46);
    const long = titleTier('The Lord of the Rings: The Fellowship of the Ring Extended Edition');
    expect(long.size).toBe(38);
    expect(long.text.endsWith('…')).toBe(true);
  });
  it('prints the rewatch line and dates', () => {
    expect(watchLine(3, 'maya')).toBe('THIRD WATCH · @maya');
    expect(watchLine(12, 'maya')).toBe('12TH WATCH · @maya');
    expect(watchedLabel('2026-03-02')).toBe('WATCHED 02 MAR 2026');
    expect(watchedLabel(null)).toBe('DATE NOT LOGGED');
  });
  it('drops glyphs our fonts lack (no Google-font fetch at render)', () => {
    expect(ogText('Amélie 🎬')).toBe('Amélie');
    expect(ogText('千と千尋の神隠し')).toBe('Untitled');
  });
});
