/**
 * C-Q4 share (ADR-013 C-07/C-08, API_CONTRACT v1.6 §5.28): the Share button (Web Share stubbed →
 * copy link → fallback sheet), `?ref=share` links, OG/story PNG routes (size, no Set-Cookie, no
 * outbound fetch), the public stub landing (no note/review text, noindex) and 404 for a deleted stub.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { APIResponse, Page } from '@playwright/test';
import {
  expect,
  gotoTitle,
  perProject,
  reviewApi,
  shot,
  signUpApi,
  stubApi,
  test,
  toast,
  waitForSession,
} from './support/fixtures';

type Shared = { url: string; title: string; text: string };

/** Replaces Web Share with a recorder (Chromium headless has no share sheet). */
async function stubWebShare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (d: unknown) => {
        w.__shared.push(d);
      },
      configurable: true,
    });
  });
}

async function noWebShare(page: Page, clipboard: 'ok' | 'fail') {
  await page.addInitScript((mode) => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    if (mode === 'fail')
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
  }, clipboard);
}

const shared = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);

async function expectPng(res: APIResponse, w: number, h: number, what: string) {
  expect(res.status(), what).toBe(200);
  expect(res.headers()['content-type'], what).toBe('image/png');
  expect(res.headers()['set-cookie'], `${what}: no Set-Cookie`).toBeUndefined();
  const b = await res.body();
  expect(b.subarray(1, 4).toString('latin1'), what).toBe('PNG');
  expect([b.readUInt32BE(16), b.readUInt32BE(20)], `${what} size`).toEqual([w, h]);
}

const NET_LOG = path.resolve(__dirname, '../.data/e2e-net.jsonl');
const outbound = () =>
  fs.existsSync(NET_LOG)
    ? fs
        .readFileSync(NET_LOG, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { kind: string })
        .filter((e) => e.kind !== 'armed')
    : null;

test.describe('C-Q4 Share button', () => {
  test('title page: Web Share gets an absolute ?ref=share link with title + year only', async ({
    page,
  }, info) => {
    await stubWebShare(page);
    await gotoTitle(page, 'movie:693134');
    const btn = page.getByRole('button', { name: 'Share Dune: Part Two' });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    const [d] = await shared(page);
    const u = new URL(d!.url);
    expect(u.pathname).toBe('/title/movie/693134-dune-part-two');
    expect(u.searchParams.get('ref')).toBe('share');
    expect(d!.title).toBe('Dune: Part Two (2024) on Stubbed');
    expect(d!.text).toBe('Dune: Part Two (2024) on Stubbed');
    await shot(page, info, 'share-title');
  });

  test('no Web Share → link copied to the clipboard with a "Link copied" toast', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await noWebShare(page, 'ok');
    await gotoTitle(page, 'movie:693134');
    await page.getByRole('button', { name: 'Share Dune: Part Two' }).click();
    await expect(toast(page).filter({ hasText: 'Link copied' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/\/title\/movie\/693134-dune-part-two\?ref=share$/);
  });

  test('no Web Share and no clipboard → fallback sheet with the link in a read-only field', async ({
    page,
  }, info) => {
    await noWebShare(page, 'fail');
    await gotoTitle(page, 'movie:693134');
    await page.getByRole('button', { name: 'Share Dune: Part Two' }).click();
    const sheet = page.getByTestId('share-fallback');
    await expect(sheet).toBeVisible();
    const field = sheet.getByLabel('Link');
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toHaveValue(/\/title\/movie\/693134-dune-part-two\?ref=share$/);
    await shot(page, info, 'share-fallback');
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();
  });

  test('diary row menu: "Share stub" shares /share/stub/{id}?ref=share; never the note', async ({
    page,
  }, info) => {
    await stubWebShare(page);
    const key = perProject(info, 'movie:335984', 'movie:361743'); // Blade Runner 2049 / Top Gun: Maverick
    await signUpApi(page, 'shd');
    const { stub } = await stubApi(page, key, { note: 'QA-PRIVATE-NOTE' });
    await page.goto('/me/stubs');
    await waitForSession(page, true);
    await page
      .getByRole('button', { name: /^Options for / })
      .first()
      .click();
    await page.getByTestId('share-stub').click();
    await expect.poll(async () => (await shared(page)).length).toBe(1);
    const [d] = await shared(page);
    expect(new URL(d!.url).pathname).toBe(`/share/stub/${stub.id}`);
    expect(new URL(d!.url).searchParams.get('ref')).toBe('share');
    expect(JSON.stringify(d)).not.toContain('QA-PRIVATE-NOTE');
  });
});

test.describe('C-Q4 share images and landing', () => {
  test('title og:image → 1200×630 PNG, no Set-Cookie; unknown title image → 404', async ({
    page,
    request,
  }) => {
    await gotoTitle(page, 'movie:693134');
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(new URL(og!).pathname).toBe('/title/movie/693134-dune-part-two/opengraph-image');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200',
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630',
    );
    await expectPng(
      await request.get('/title/movie/693134-dune-part-two/opengraph-image'),
      1200,
      630,
      'title og',
    );
    expect((await request.get('/title/movie/999999999-x/opengraph-image')).status()).toBe(404);
  });

  test('stub landing + og + story: right PNG sizes, no Set-Cookie, no note/review text, noindex; deleted stub → 404', async ({
    page,
    playwright,
    baseURL,
  }, info) => {
    const key = perProject(info, 'tv:136315', 'tv:94605'); // The Bear / Arcane
    const acc = await signUpApi(page, 'shl');
    const { stub } = await stubApi(page, key, { note: 'QA-SECRET-NOTE-42' });
    await reviewApi(page, key, { rating10: 8, body: 'QA-REVIEW-BODY-42', isSpoiler: true });
    const before = outbound();

    // Anonymous visitor: a fresh request context with no cookies.
    const anon = await playwright.request.newContext({ baseURL });
    const base = `/share/stub/${stub.id}`;
    const land = await anon.get(base, { maxRedirects: 0 });
    expect(land.status()).toBe(200);
    expect(land.headers()['set-cookie']).toBeUndefined();
    const html = await land.text();
    expect(html).not.toContain('QA-SECRET-NOTE-42');
    expect(html).not.toContain('QA-REVIEW-BODY-42');
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
    expect(html).toMatch(/<link rel="canonical" href="[^"]*\/title\/tv\//);
    expect(html).toContain(`${base}/opengraph-image`);
    await expectPng(await anon.get(`${base}/opengraph-image`), 1200, 630, 'stub og');
    await expectPng(await anon.get(`${base}/story`), 1080, 1920, 'story');
    const dl = await anon.get(`${base}/story?download=1`);
    await expectPng(dl, 1080, 1920, 'story download');
    expect(dl.headers()['content-disposition']).toMatch(/^attachment; filename="[^"]+\.png"$/);

    // The landing renders for a visitor (ticket + Stub it), and never the note.
    await page.context().clearCookies();
    await page.goto(base);
    await expect(page.locator('main')).toContainText(`@${acc.handle}`);
    await expect(page.locator('main')).not.toContainText('QA-SECRET-NOTE-42');
    await shot(page, info, 'share-landing');

    // ADR-006: rendering the images made no outbound connection (net guard log; skipped if absent).
    const after = outbound();
    if (before && after)
      expect(after.slice(before.length), 'outbound from image routes').toEqual([]);

    // Delete the stub (owner) → landing and images are 404.
    await page.context().clearCookies();
    await page.request.post('/api/auth/signin', {
      data: { email: acc.email, password: acc.password },
      headers: { 'x-forwarded-for': '10.88.1.2' },
    });
    expect((await page.request.delete(`/api/stubs/${stub.id}`)).status()).toBe(200);
    for (const p of [base, `${base}/opengraph-image`, `${base}/story`])
      expect((await anon.get(p, { maxRedirects: 0 })).status(), p).toBe(404);
    expect((await anon.get('/share/stub/00000000-0000-4000-8000-000000000000')).status()).toBe(404);
    await anon.dispose();
  });
});
