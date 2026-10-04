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
 *
 * Close-out checks that only show up on a real deploy (ADR-013 C-14, AR-C5): real 404 / 308 status
 * codes (C-03), "On {Service}" chips on /browse (C-02), and the OG + story PNGs at their exact sizes
 * (C-08: font tracing and the image runtime only fail on the platform).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type TestInfo,
} from '@playwright/test';
import { enrichmentAppends } from '../src/server/jobs/enrich';
import { pngSize } from '../scripts/lib/png';

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

/** GET `path` (same origin, no secret in it) and assert a PNG of exactly `width`×`height`. */
async function expectPng(request: APIRequestContext, path: string, width: number, height: number) {
  const res = await request.get(path);
  expect(res.status(), `${path}: HTTP status`).toBe(200);
  expect(res.headers()['content-type'], `${path}: content-type`).toMatch(/^image\/png\b/);
  const size = pngSize(await res.body());
  expect(size, `${path}: PNG size`).toEqual({ width, height });
  return { path, httpStatus: res.status(), contentType: res.headers()['content-type'], ...size };
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
          (imgs) =>
            (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length,
        ),
      { message: 'no TMDB poster finished loading', timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await evidence(info, 'home-posters', { posterImgs: await posters.count() });
});

// Plain `fetch`, not a Playwright request context: the runner traces every APIRequestContext (headers
// and query included) and `trace: 'retain-on-failure'` uploads it in the evidence artifact, which would
// carry the TMDB token (security review SR-2).
test('TMDB detail response includes the "watch/providers" key', async ({}, info) => {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  expect(token || apiKey, 'set TMDB_READ_TOKEN (or TMDB_API_KEY) for this check').toBeTruthy();
  const mediaType = TYPE === 'tv' ? 'tv' : 'movie';
  const appends = enrichmentAppends(mediaType);
  const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${TMDB_ID}`);
  url.searchParams.set('append_to_response', appends);
  if (!token && apiKey) url.searchParams.set('api_key', apiKey);
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  // Status only on failure: never the URL (it may carry api_key).
  expect(res.ok, `TMDB detail: HTTP ${res.status}`).toBe(true);
  const body = (await res.json()) as Record<string, unknown>;
  const wp = body['watch/providers'] as { results?: Record<string, unknown> } | undefined;
  // Evidence: key names and region codes only (no token, no full payload).
  await evidence(info, 'tmdb-watch-providers', {
    request: `GET /3/${mediaType}/${TMDB_ID}?append_to_response=${appends}`,
    httpStatus: res.status,
    topLevelKeys: Object.keys(body).sort(),
    hasWatchProvidersKey: 'watch/providers' in body,
    regions: wp?.results ? Object.keys(wp.results).sort() : null,
  });
  expect(Object.keys(body)).toContain('watch/providers');
  expect(typeof wp?.results).toBe('object');
});

test('title page shows TMDB + IMDb ratings and Where to watch', async ({ page }, info) => {
  await page.goto(`/title/${TYPE}/${TMDB_ID}`);
  await expect(page).toHaveURL(new RegExp(`/title/${TYPE}/${TMDB_ID}-`));
  const chips = page.getByRole('list', { name: 'Ratings' });
  await expect(chips.getByTestId('tmdb-rating')).toBeVisible();
  await expect(
    chips.getByTestId('imdb-rating'),
    'IMDb chip (needs the OMDb nightly step)',
  ).toBeVisible();
  const wtw = page.getByTestId('where-to-watch');
  await expect(wtw, 'Where to watch block (needs the watch step of the sync)').toBeVisible();
  await evidence(info, 'title-page', {
    url: page.url(),
    tmdb: (await chips.getByTestId('tmdb-rating').innerText()).replace(/\s+/g, ' '),
    imdb: (await chips.getByTestId('imdb-rating').innerText()).replace(/\s+/g, ' '),
    providerTiles: await wtw.locator('a[data-testid^="wtw-provider-"]').count(),
  });
});

test('real status codes: unknown title is 404, a wrong slug is a 308 to the canonical URL', async ({
  request,
}, info) => {
  const notFound: Record<string, number> = {};
  for (const url of ['/title/movie/0-x', '/title/movie/999999999-made-up']) {
    const r = await request.get(url, { maxRedirects: 0 });
    notFound[url] = r.status();
    expect(r.status(), `${url} (a soft 404 would be 200)`).toBe(404);
  }
  const from = `/title/${TYPE}/${TMDB_ID}-wrong-slug`;
  const r = await request.get(from, { maxRedirects: 0 });
  const location = r.headers()['location'] ?? '';
  const to = new URL(location, 'http://x').pathname;
  await evidence(info, 'status-codes', { notFound, redirect: { from, status: r.status(), to } });
  expect(r.status(), `${from} redirect status`).toBe(308);
  expect(to).toMatch(new RegExp(`^/title/${TYPE}/${TMDB_ID}-[a-z0-9-]+$`));
  expect(to).not.toBe(from);
});

test('/browse shows "On {Service}" provider chips (US)', async ({ page, baseURL }, info) => {
  const api = await page.request.get('/api/watch/providers?region=US');
  expect(api.status(), '/api/watch/providers?region=US').toBe(200);
  const { providers = [] } = (await api.json()) as { providers?: { providerId: number }[] };
  expect(providers.length, 'provider chips need the watch step of the sync').toBeGreaterThan(0);
  // Pin the region so the chips do not depend on the runner's geo header.
  await page.context().addCookies([{ name: 'stubbed_region', value: 'US', url: baseURL! }]);
  await page.goto('/browse');
  const nav = page.getByTestId('provider-filter');
  await expect(nav).toBeVisible();
  const chips = nav.locator(
    '[data-testid^="provider-chip-"]:not([data-testid="provider-chip-all"])',
  );
  await expect(chips.first()).toBeVisible();
  await evidence(info, 'browse-provider-chips', {
    apiProviders: providers.length,
    chips: await chips.count(),
  });
});

test('title OG image is a 1200×630 PNG', async ({ page }, info) => {
  await page.goto(`/title/${TYPE}/${TMDB_ID}`);
  const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(og, 'og:image meta tag').toBeTruthy();
  const u = new URL(og!, page.url());
  // Path only, fetched from the deploy under test: og:image is absolute on NEXT_PUBLIC_SITE_URL, which
  // may be another host than a preview deploy. The smoke never calls a host it read from the page.
  await evidence(info, 'og-image', await expectPng(page.request, u.pathname + u.search, 1200, 630));
});

test('throwaway account: sign-up → stub → review → export → delete', async ({ page }, info) => {
  const acc = throwawayAccount();
  let created = false;
  let deleted = false;
  try {
    const signup = await page.request.post('/api/auth/signup', { data: acc });
    if (signup.status() === 202)
      throw new Error(
        `Sign-up needs email confirmation: turn "Confirm email" OFF in Supabase (README §3), then delete ${acc.handle} under Authentication → Users.`,
      );
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
    const story = await expectPng(
      page.request,
      `/share/stub/${encodeURIComponent(stub.id)}/story`,
      1080,
      1920,
    );

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
      steps: [
        'signup 201',
        'stub 201',
        `story ${story.width}x${story.height} png`,
        `review ${review.status()}`,
        'export 200',
        'delete 204',
        'signin refused',
      ],
      stubTitleKey: stub.titleKey,
      exportRows: csv.split('\n').filter(Boolean).length - 1,
    });
  } finally {
    // Cleanup even when a step failed: the account must not outlive the run.
    if (created && !deleted)
      await page.request.delete('/api/me', { data: { confirm: 'DELETE' } }).catch(() => undefined);
  }
});
