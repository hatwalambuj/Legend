/**
 * LIVE staging smoke (C-14, FOUNDER_INPUTS F6). Runs ONLY via playwright.live.config.ts
 * (`npm run smoke:live -- --url https://<deploy>` or .github/workflows/smoke-live.yml), never in
 * `npm run test:e2e`. Talks to the real deploy, TMDB and Supabase.
 *
 * Creates ONE throwaway account (`<SMOKE_EMAIL local>+smoke<id>@<domain>`, Confirm email must be OFF so
 * no mail is sent) and deletes it at the end (also on failure, in afterAll).
 *
 * Env: SMOKE_URL (required), TMDB_READ_TOKEN or TMDB_API_KEY (the watch/providers evidence),
 * SMOKE_EMAIL (base address on a real mail domain; Supabase may reject example.com),
 * SMOKE_TITLE (default movie:693134, Dune: Part Two). Evidence JSON → test-results-live/evidence/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { enrichmentAppends } from '../src/server/jobs/enrich';

const [TYPE = 'movie', ID = '693134'] = (process.env.SMOKE_TITLE ?? 'movie:693134').split(':');
const TMDB_ID = Number(ID);
const EVIDENCE_DIR = join(process.cwd(), 'test-results-live', 'evidence');

async function evidence(info: TestInfo, name: string, data: unknown) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const body = `${JSON.stringify({ recordedAt: new Date().toISOString(), ...(data as object) }, null, 2)}\n`;
  writeFileSync(join(EVIDENCE_DIR, `${name}.json`), body);
  await info.attach(name, { body, contentType: 'application/json' });
}

async function ok(res: APIResponse, what: string, status?: number) {
  const text = res.ok() ? '' : (await res.text()).slice(0, 300);
  expect(res.ok(), `${what}: HTTP ${res.status()} ${text}`).toBe(true);
  if (status) expect(res.status(), what).toBe(status);
}

function throwawayAccount() {
  const base = process.env.SMOKE_EMAIL?.trim() || 'smoke@example.com';
  const [local = 'smoke', domain = 'example.com'] = base.split('@');
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    email: `${local.split('+')[0]}+smoke${id}@${domain}`,
    // Random per run; never logged. Satisfies the 8–72 rule.
    password: `Sm0ke-${crypto.randomUUID()}`,
    handle: `smoke_${id}`.slice(0, 20),
  };
}

test.describe.configure({ mode: 'serial' });

test('GET /api/health answers 200 with status "ok"', async ({ request }, info) => {
  const res = await request.get('/api/health', { headers: { 'Cache-Control': 'no-cache' } });
  const body = (await res.json()) as { ok?: boolean; status?: string; mode?: unknown };
  await evidence(info, 'health', { httpStatus: res.status(), body });
  expect(res.status(), 'health HTTP status').toBe(200);
  expect(body.status, 'health status ("degraded" = run the first catalogue sync)').toBe('ok');
});

test('home is live (no demo pill) and loads real TMDB posters', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-pill')).toHaveCount(0);
  const posters = page.locator('img[src^="https://image.tmdb.org/t/p/"]');
  await expect(posters.first()).toBeVisible();
  // At least one poster actually decoded (not just an <img> tag pointing at TMDB).
  await expect
    .poll(
      () =>
        posters.evaluateAll(
          (imgs) => (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length,
        ),
      { message: 'no TMDB poster finished loading', timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await evidence(info, 'home-posters', { posterImgs: await posters.count() });
});

test('TMDB detail response includes the "watch/providers" key', async ({ playwright }, info) => {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  expect(token || apiKey, 'set TMDB_READ_TOKEN (or TMDB_API_KEY) for this check').toBeTruthy();
  const ctx = await playwright.request.newContext({
    baseURL: 'https://api.themoviedb.org',
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  try {
    const mediaType = TYPE === 'tv' ? 'tv' : 'movie';
    const params: Record<string, string> = { append_to_response: enrichmentAppends(mediaType) };
    if (!token && apiKey) params.api_key = apiKey;
    const res = await ctx.get(`/3/${mediaType}/${TMDB_ID}`, { params });
    await ok(res, 'TMDB detail');
    const body = (await res.json()) as Record<string, unknown>;
    const wp = body['watch/providers'] as { results?: Record<string, unknown> } | undefined;
    // Evidence: key names and region codes only (no token, no full payload).
    await evidence(info, 'tmdb-watch-providers', {
      request: `GET /3/${mediaType}/${TMDB_ID}?append_to_response=${params.append_to_response}`,
      httpStatus: res.status(),
      topLevelKeys: Object.keys(body).sort(),
      hasWatchProvidersKey: 'watch/providers' in body,
      regions: wp?.results ? Object.keys(wp.results).sort() : null,
    });
    expect(Object.keys(body)).toContain('watch/providers');
    expect(typeof wp?.results).toBe('object');
  } finally {
    await ctx.dispose();
  }
});

test('title page shows TMDB + IMDb ratings and Where to watch', async ({ page }, info) => {
  await page.goto(`/title/${TYPE}/${TMDB_ID}`);
  await expect(page).toHaveURL(new RegExp(`/title/${TYPE}/${TMDB_ID}-`));
  const chips = page.getByRole('list', { name: 'Ratings' });
  await expect(chips.getByTestId('tmdb-rating')).toBeVisible();
  await expect(chips.getByTestId('imdb-rating'), 'IMDb chip (needs the OMDb nightly step)').toBeVisible();
  const wtw = page.getByTestId('where-to-watch');
  await expect(wtw, 'Where to watch block (needs the watch step of the sync)').toBeVisible();
  await evidence(info, 'title-page', {
    url: page.url(),
    tmdb: (await chips.getByTestId('tmdb-rating').innerText()).replace(/\s+/g, ' '),
    imdb: (await chips.getByTestId('imdb-rating').innerText()).replace(/\s+/g, ' '),
    providerTiles: await wtw.locator('a[data-testid^="wtw-provider-"]').count(),
  });
});

test.describe('throwaway account: sign-up → stub → review → export → delete', () => {
  const acc = throwawayAccount();
  let page: Page;
  let deleted = false;
  let created = false;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
  });

  test.afterAll(async () => {
    // Cleanup even when a step failed: the account must not outlive the run.
    if (created && !deleted)
      await page.request
        .delete('/api/me', { data: { confirm: 'DELETE' } })
        .catch(() => undefined);
    await page.context().close();
  });

  test('flow', async ({}, info) => {
    const signup = await page.request.post('/api/auth/signup', { data: acc });
    if (signup.status() === 202)
      throw new Error('Sign-up needs email confirmation: turn "Confirm email" OFF in Supabase (README §3).');
    await ok(signup, 'sign-up', 201);
    created = true;

    const me = (await (await page.request.get('/api/me')).json()) as {
      session: { user: { handle: string } } | null;
    };
    expect(me.session?.user.handle).toBe(acc.handle);

    const mediaType = TYPE === 'tv' ? 'tv' : 'movie';
    const stubRes = await page.request.post('/api/stubs', {
      data: { mediaType, tmdbId: TMDB_ID, note: 'live smoke (auto-deleted)' },
    });
    await ok(stubRes, 'stub', 201);
    const { stub } = (await stubRes.json()) as { stub: { id: string; titleKey: string } };

    const review = await page.request.put('/api/reviews', {
      data: {
        mediaType,
        tmdbId: TMDB_ID,
        rating10: 8,
        body: 'Live smoke test review. This account is deleted at the end of the run.',
        stubId: stub.id,
      },
    });
    await ok(review, 'review');

    const exp = await page.request.get('/api/me/export?format=letterboxd');
    await ok(exp, 'export', 200);
    const csv = await exp.text();
    expect(exp.headers()['content-disposition']).toMatch(/attachment/);
    expect(csv.split('\n').filter(Boolean).length, 'header + 1 row').toBeGreaterThanOrEqual(2);

    const del = await page.request.delete('/api/me', { data: { confirm: 'DELETE' } });
    await ok(del, 'delete account', 204);
    deleted = true;
    const after = (await (await page.request.get('/api/me')).json()) as { session: unknown };
    expect(after.session).toBeNull();
    const signin = await page.request.post('/api/auth/signin', {
      data: { email: acc.email, password: acc.password },
    });
    expect(signin.ok(), 'deleted account can no longer sign in').toBe(false);

    await evidence(info, 'account-flow', {
      steps: ['signup 201', 'stub 201', `review ${review.status()}`, 'export 200', 'delete 204', 'signin refused'],
      stubTitleKey: stub.titleKey,
      exportRows: csv.split('\n').filter(Boolean).length - 1,
    });
  });
});
