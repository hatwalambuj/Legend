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
const stubOg = await import('@/app/share/stub/[id]/opengraph-image');
const titleOg = await import('@/app/title/[type]/[slug]/opengraph-image');
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
      new Request(`http://localhost/share/stub/${SEED_STUB}/story?download=1`),
      params({ id: SEED_STUB }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=600');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="stubbed-stub-\d+\.png"$/,
    );
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1080, height: 1920 });
  }, 30_000);

  it('404s an unknown or malformed stub', async () => {
    for (const id of ['0a000000-0000-4000-8000-000000000000', 'nope']) {
      const res = await story.GET(
        new Request(`http://localhost/share/stub/${id}/story`),
        params({ id }),
      );
      expect(res.status).toBe(404);
    }
  });
});

describe('og images', () => {
  it('stub og is 1200×630', async () => {
    const res = (await stubOg.default(params({ id: SEED_STUB }))) as Response;
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it('title og is 1200×630 with the long cache', async () => {
    const res = (await titleOg.default(
      params({ type: 'movie', slug: '693134-dune-part-two' }),
    )) as Response;
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=86400, stale-while-revalidate=604800',
    );
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1200, height: 630 });
  }, 30_000);
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
