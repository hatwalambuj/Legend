/**
 * C-Q2 (ADR-013 C-03, API_CONTRACT v1.6 "real 404/308 on pages"): status codes read with the request API
 * and `maxRedirects: 0`, so a soft 404 (200 + noindex) or an in-stream redirect can never pass.
 */
import { expect, signUpApi, test } from './support/fixtures';

test.describe('C-Q2 real HTTP status for pages', () => {
  test('unknown title / user / route → 404 with the not-found page', async ({ request }) => {
    for (const url of [
      '/title/movie/999999999',
      '/title/movie/999999999-made-up',
      '/title/tv/999999999',
      '/title/film/603',
      '/u/nobody_here',
      '/u/zz_no_such_user_9',
      '/nope',
    ]) {
      const r = await request.get(url, { maxRedirects: 0 });
      expect(r.status(), url).toBe(404);
      expect(await r.text(), url).toContain('data-testid="not-found"');
    }
  });

  test('slugless and stale-slug title URLs → 308 to the canonical slug (query kept)', async ({
    request,
  }) => {
    const cases: [string, string][] = [
      ['/title/movie/693134', '/title/movie/693134-dune-part-two'],
      ['/title/movie/693134-wrong-slug', '/title/movie/693134-dune-part-two'],
      ['/title/tv/1396', '/title/tv/1396-breaking-bad'],
      ['/title/movie/693134-x?region=GB', '/title/movie/693134-dune-part-two?region=GB'],
    ];
    for (const [from, to] of cases) {
      const r = await request.get(from, { maxRedirects: 0 });
      expect(r.status(), from).toBe(308);
      const loc = new URL(r.headers()['location']!, 'http://x');
      expect(loc.pathname + loc.search, from).toBe(to);
    }
    const ok = await request.get('/title/movie/693134-dune-part-two', { maxRedirects: 0 });
    expect(ok.status()).toBe(200);
  });

  test('a known user profile is 200; the same handle after account deletion is 404', async ({
    page,
  }) => {
    expect((await page.request.get('/u/maya', { maxRedirects: 0 })).status()).toBe(200);
    const acc = await signUpApi(page, 'st');
    expect((await page.request.get(`/u/${acc.handle}`, { maxRedirects: 0 })).status()).toBe(200);
    const del = await page.request.delete('/api/me', { data: { confirm: 'DELETE' } });
    expect(del.status()).toBe(204);
    expect((await page.request.get(`/u/${acc.handle}`, { maxRedirects: 0 })).status()).toBe(404);
  });
});
