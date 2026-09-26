/**
 * Shared E2E fixtures and helpers (QA). Every test automatically fails on:
 *  - any browser console error or uncaught page error (unless the test allow-lists it), and
 *  - any browser request to a host other than the app (demo mode = zero third-party network).
 * Tests that mutate data use fresh accounts (unique handles) so the suite can re-run on a warm server.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  test as base,
  expect,
  type APIResponse,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

export { expect };

export const DEMO_PASSWORD = 'stubbed-demo';
export const TODAY = '2026-09-26';
export const SHOTS = path.resolve(__dirname, '../../docs/06-qa/screenshots');

type Fixtures = {
  /** Push a RegExp to tolerate an expected console error (e.g. a deliberate 401). */
  allowConsole: RegExp[];
  consoleGuard: void;
};

/**
 * React 19 streams the page into a hidden `<div hidden id="S:0">` and reveals it (throttled) after
 * `load`, so for a moment the DOM can hold the content twice. Navigations wait for the reveal.
 */
async function settled(page: Page) {
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
}

export const test = base.extend<Fixtures>({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url, opts) => {
      const res = await goto(url, opts);
      await settled(page);
      return res;
    };
    page.reload = async (opts) => {
      const res = await reload(opts);
      await settled(page);
      return res;
    };
    await provide(page);
  },
  allowConsole: [[], { option: false }],
  consoleGuard: [
    async ({ page, allowConsole, baseURL }, provide) => {
      const errors: string[] = [];
      const external: string[] = [];
      const appHost = new URL(baseURL ?? 'http://127.0.0.1:3100').host;
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('request', (r) => {
        const u = new URL(r.url());
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host !== appHost)
          external.push(r.url());
      });
      await provide();
      const unexpected = errors.filter((e) => !allowConsole.some((re) => re.test(e)));
      expect(unexpected, 'browser console errors').toEqual([]);
      expect(external, 'requests to third-party hosts').toEqual([]);
    },
    { auto: true },
  ],
});

let seq = 0;
/** Unique, valid handle (3–20 chars, [a-z0-9_]). */
export function uniqueHandle(prefix = 'qa'): string {
  seq += 1;
  const t = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}${t}${r}${seq}`.slice(0, 20).toLowerCase();
}

/** Spread API sign-ups over fake client IPs so the per-IP auth limiter never trips in long runs. */
function fakeIp(): string {
  const b = () => Math.floor(Math.random() * 250) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

export interface Account {
  email: string;
  password: string;
  handle: string;
}

async function ok(res: APIResponse, what: string) {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  return res;
}

/**
 * Creates a fresh account through the API. `page.request` shares the browser context's cookie jar,
 * so the page is signed in afterwards.
 */
export async function signUpApi(page: Page, prefix = 'qa'): Promise<Account> {
  const handle = uniqueHandle(prefix);
  const acc = { email: `${handle}@e2e.test`, password: 'correct-horse-9', handle };
  await ok(
    await page.request.post('/api/auth/signup', {
      data: acc,
      headers: { 'x-forwarded-for': fakeIp() },
    }),
    'signup',
  );
  return acc;
}

export async function signInApi(page: Page, email: string, password = DEMO_PASSWORD) {
  await ok(
    await page.request.post('/api/auth/signin', {
      data: { email, password },
      headers: { 'x-forwarded-for': fakeIp() },
    }),
    'signin',
  );
}

export async function stubApi(
  page: Page,
  key: string,
  body: { watchedOn?: string; watchedWhere?: string | null; note?: string } = {},
) {
  const [mediaType, id] = key.split(':');
  const res = await ok(
    await page.request.post('/api/stubs', {
      data: { mediaType, tmdbId: Number(id), ...body },
    }),
    'stub',
  );
  return (await res.json()) as { stub: { id: string }; state: { stubCount: number } };
}

export async function reviewApi(
  page: Page,
  key: string,
  body: { rating10: number; body?: string; isSpoiler?: boolean },
) {
  const [mediaType, id] = key.split(':');
  const res = await ok(
    await page.request.put('/api/reviews', { data: { mediaType, tmdbId: Number(id), ...body } }),
    'review',
  );
  return (await res.json()) as { review: { id: string } };
}

export interface ApiTitle {
  key: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  slug: string;
  releaseDate: string;
  year: number;
  voteAverage: number;
  voteCount: number;
  imdbRating: number | null;
  isListed: boolean;
}

/** Walks every catalogue page through the public API (keyset cursor). */
export async function walkCatalog(
  page: Page,
  q: { type?: string; sort?: string; limit?: number } = {},
): Promise<{ items: ApiTitle[]; total: number; pages: number }> {
  const items: ApiTitle[] = [];
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: String(q.limit ?? 20) });
    if (q.type) params.set('type', q.type);
    if (q.sort) params.set('sort', q.sort);
    if (cursor) params.set('cursor', cursor);
    const res = await ok(await page.request.get(`/api/catalog?${params}`), 'catalog');
    const body = (await res.json()) as {
      items: ApiTitle[];
      nextCursor: string | null;
      total: number;
    };
    items.push(...body.items);
    total = body.total;
    cursor = body.nextCursor;
    pages += 1;
    if (pages > 50) throw new Error('catalog walk did not terminate');
  } while (cursor);
  return { items, total, pages };
}

export function titlePath(t: Pick<ApiTitle, 'mediaType' | 'tmdbId' | 'slug'>): string {
  return `/title/${t.mediaType}/${t.tmdbId}-${t.slug}`;
}

export function isMobile(info: TestInfo): boolean {
  return info.project.name === 'mobile';
}

/** Different titles per project, so desktop and mobile runs never write to the same title. */
export function perProject<T>(info: TestInfo, desktop: T, mobile: T): T {
  return isMobile(info) ? mobile : desktop;
}

/** Saves docs/06-qa/screenshots/qa-<name>-<project>.png. */
export async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const width = isMobile(info) ? '375' : '1440';
  await page.screenshot({ path: path.join(SHOTS, `qa-${name}-${width}.png`), fullPage });
}

/** PRD A1-AC3: the document never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
  }));
  expect(m.sw, `scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw + 1);
  expect(m.bw).toBeLessThanOrEqual(m.cw + 1);
}

/** Waits for the client session island (header avatar or "Sign in") to settle. */
export async function waitForSession(page: Page, signedIn: boolean) {
  if (signedIn) await expect(page.getByRole('link', { name: /Your profile \(@/ })).toBeVisible();
  else await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeAttached();
}

export function toast(page: Page): Locator {
  return page.getByTestId('toast');
}

/** The primary "Stub it" CTA on a title page (the ticket buttons share the test id). */
export function detailStubButton(page: Page): Locator {
  return page.locator('main').getByRole('button', { name: /^(Stub it|Stub again)$/ });
}

export function detailStubLine(page: Page): Locator {
  return page.locator('p[data-testid="stub-count"]');
}

export async function gotoTitle(page: Page, key: string) {
  const [type, id] = key.split(':');
  await page.goto(`/title/${type}/${id}`);
  await expect(page).toHaveURL(new RegExp(`/title/${type}/${id}-`));
}
