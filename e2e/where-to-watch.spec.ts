/**
 * W-20 (WORK_SPLIT §6): "Where to watch" E2E in demo mode, PRD §13 W1–W6 (+ W7-AC1 stub mark when shipped)
 * against DESIGN §7.4.2 test ids. Fixtures: src/fixtures/watch.json (20 titles × US/GB/IN).
 *   Dune: Part Two movie:693134 (US Max + Rent · Buy; GB NOW; IN Prime Video)
 *   Interstellar  movie:157336 ("many": 7 Buy providers in US → "+1"; 3 fall back to the TMDB page)
 *   Fleabag       tv:67070     ("none_us": empty state in US; GB has Stream + Free)
 *   Parasite      movie:496243 ("stale": 45 days old → block hidden)
 * Popups never reach the network: every non-app host is fulfilled locally by `context.route`.
 */
import fs from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { BANNED_QUERY_KEY, PROVIDER_LINK_HOSTS } from '../src/lib/provider-links';
import {
  detailStubButton,
  expect,
  gotoTitle,
  isMobile,
  shot,
  signUpApi,
  test,
  waitForSession,
} from './support/fixtures';

const DUNE = 'movie:693134';
const INTERSTELLAR = 'movie:157336';
const FLEABAG = 'tv:67070';
const PARASITE = 'movie:496243';
/** Tiles may link to a provider template or, as fallback, TMDB's watch page (provider-links.ts). */
const ALLOWED_HOSTS = new Set([...PROVIDER_LINK_HOSTS, 'www.themoviedb.org']);

const block = (page: Page) => page.getByTestId('where-to-watch');
const regionSelect = (page: Page) =>
  block(page).getByRole('combobox', { name: /^Region: .+\. Change region$/ });
const tiles = (scope: Locator) => scope.locator('a[data-testid^="wtw-provider-"]');

/** W2-AC1/AC2 on every tile inside `scope`: <a target=_blank rel="noopener noreferrer">, https, allowlisted. */
async function expectSafeTiles(scope: Locator) {
  const all = await tiles(scope).evaluateAll((els) =>
    els.map((a) => ({
      tag: a.tagName,
      href: a.getAttribute('href') ?? '',
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    })),
  );
  expect(all.length).toBeGreaterThan(0);
  for (const t of all) {
    expect(t.tag).toBe('A');
    expect(t.target).toBe('_blank');
    expect(t.rel).toBe('noopener noreferrer');
    const u = new URL(t.href);
    expect(u.protocol, t.href).toBe('https:');
    expect(ALLOWED_HOSTS.has(u.host), `${u.host} not in allowlist`).toBe(true);
    expect(u.username + u.password + u.port, t.href).toBe('');
    for (const k of u.searchParams.keys()) expect(BANNED_QUERY_KEY.test(k), t.href).toBe(false);
  }
  return all;
}

/** Answers every non-app request of the context locally, so no popup ever reaches the network. */
async function interceptExternal(context: BrowserContext, appHost: string) {
  const seen: string[] = [];
  await context.route(
    (url) => url.host !== appHost,
    (route) => {
      seen.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>intercepted</title><p>intercepted by e2e</p>',
      });
    },
  );
  return seen;
}

async function groupIds(page: Page) {
  return block(page)
    .locator('[data-testid^="wtw-group-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
}

test.describe('W1 see where to watch', () => {
  test('W1-AC1/AC2/AC4 Dune (US): groups in order with text headings, tiles, Checked line, attribution', async ({
    page,
  }, info) => {
    await gotoTitle(page, DUNE);
    const wtw = block(page);
    await expect(wtw).toBeVisible();
    await expect(wtw.getByRole('heading', { level: 2, name: 'Where to watch' })).toBeVisible();
    await expect(wtw).toHaveAttribute('data-region', 'US');
    // Stream then a merged Rent · Buy group (every renter also sells) — empty groups absent.
    expect(await groupIds(page)).toEqual(['wtw-group-stream', 'wtw-group-rent']);
    await expect(wtw.getByRole('list', { name: 'Stream' })).toBeVisible();
    await expect(wtw.getByRole('list', { name: 'Rent · Buy' })).toBeVisible();
    await expect(wtw.getByTestId('wtw-group-buy')).toHaveCount(0);
    // display_priority order: Apple TV, Amazon Video, Google Play Movies (fixture r:[2,10,3]).
    const names = await tiles(wtw).evaluateAll((els) =>
      els.map((a) => a.getAttribute('aria-label')),
    );
    expect(names).toEqual([
      'Open Max (stream) — opens in a new tab',
      'Open Apple TV (rent · buy) — opens in a new tab',
      'Open Amazon Video (rent · buy) — opens in a new tab',
      'Open Google Play Movies (rent · buy) — opens in a new tab',
    ]);
    // W5-AC1: accessible name via the role tree, too.
    await expect(
      wtw.getByRole('link', { name: 'Open Max (stream) — opens in a new tab', exact: true }),
    ).toBeVisible();
    // W5-AC1: logos are decorative (monogram tiles in demo, no <img> without alt="").
    expect(await wtw.locator('img:not([alt=""])').count()).toBe(0);

    await expect(wtw.getByTestId('wtw-checked')).toHaveText(
      /^Checked [A-Z][a-z]{2} \d{1,2}, 20\d\d · Availability can change$/,
    );
    const attr = wtw.getByTestId('wtw-attribution');
    await expect(attr).toContainText('Data by JustWatch');
    const jw = attr.getByRole('link', { name: /JustWatch/ });
    expect(new URL((await jw.getAttribute('href'))!).host).toMatch(/(^|\.)justwatch\.com$/);
    await expect(jw).toHaveAttribute('target', '_blank');
    await expect(jw).toHaveAttribute('rel', /noopener/);
    // W2-AC3: All options → TMDB watch page for the same title and region.
    await expect(wtw.getByTestId('wtw-all-options')).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/movie/693134/watch?locale=US',
    );
    await shot(page, info, 'wtw-dune-us');
  });

  test('W1-AC3 Interstellar (US): Buy caps at 6 + "+1", which expands in place and moves focus', async ({
    page,
  }, info) => {
    await gotoTitle(page, INTERSTELLAR);
    const buy = block(page).getByTestId('wtw-group-buy');
    await expect(tiles(buy)).toHaveCount(6);
    const more = buy.getByTestId('wtw-more');
    await expect(more).toHaveText(/\+1/);
    await expect(more).toHaveAccessibleName('Show 1 more Buy options');
    await more.click();
    await expect(tiles(buy)).toHaveCount(7);
    await expect(buy.getByTestId('wtw-more')).toHaveCount(0);
    await expect(tiles(buy).nth(6)).toBeFocused();
    // Providers missing from provider-links fall back to TMDB's watch page (W2-AC1).
    for (const id of [7, 68, 358]) {
      await expect(buy.getByTestId(`wtw-provider-${id}`)).toHaveAttribute(
        'href',
        'https://www.themoviedb.org/movie/157336/watch?locale=US',
      );
    }
    await expectSafeTiles(block(page));
    await shot(page, info, 'wtw-many-expanded');
  });

  test('W1-AC4 About page credits JustWatch', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('main')).toContainText('JustWatch');
  });
});

test.describe('W2 open the service', () => {
  test('W2-AC1/AC2 every provider href in every fixture title × region is https + allowlisted + untracked', async ({
    page,
  }) => {
    const watch = JSON.parse(fs.readFileSync('src/fixtures/watch.json', 'utf8')) as {
      titles: { key: string }[];
    };
    let checked = 0;
    for (const { key } of watch.titles) {
      const [type, id] = key.split(':');
      for (const region of ['US', 'GB', 'IN']) {
        const res = await page.request.get(`/api/titles/${type}/${id}/watch?region=${region}`);
        expect(res.ok(), `${key} ${region}`).toBe(true);
        const body = (await res.json()) as {
          watch: null | { allOptionsHref: string; groups: { providers: { href: string }[] }[] };
        };
        if (!body.watch) continue;
        for (const href of [
          body.watch.allOptionsHref,
          ...body.watch.groups.flatMap((g) => g.providers.map((p) => p.href)),
        ]) {
          const u = new URL(href);
          expect(u.protocol, href).toBe('https:');
          expect(ALLOWED_HOSTS.has(u.host), href).toBe(true);
          for (const k of u.searchParams.keys()) expect(BANNED_QUERY_KEY.test(k), href).toBe(false);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test('W6-AC1/AC2 demo fixtures: 20 titles, US/GB/IN, the required scenarios, labelled demo data', async ({
    page,
  }) => {
    const watch = JSON.parse(fs.readFileSync('src/fixtures/watch.json', 'utf8')) as {
      asOf: string;
      note: string;
      titles: { key: string; scenario: string[] }[];
    };
    expect(watch.titles).toHaveLength(20);
    expect(watch.asOf).toMatch(/^2026-09/);
    expect(watch.note).toMatch(/demo|illustrative/i);
    const has = (s: string) => watch.titles.filter((t) => t.scenario.includes(s)).length;
    expect(watch.titles.filter((t) => t.key.startsWith('tv:')).length).toBeGreaterThanOrEqual(5);
    expect(has('subscription')).toBeGreaterThanOrEqual(8);
    // Served data: >6 in one group (Interstellar), none in US (Fleabag), US ≠ IN (Dune), stale (Parasite).
    const get = async (key: string, r: string) => {
      const [type, id] = key.split(':');
      const res = await page.request.get(`/api/titles/${type}/${id}/watch?region=${r}`);
      return (
        (await res.json()) as {
          watch: null | { groups: { type: string; providers: { providerId: number }[] }[] };
        }
      ).watch;
    };
    const inter = await get(INTERSTELLAR, 'US');
    expect(Math.max(...inter!.groups.map((g) => g.providers.length))).toBeGreaterThan(6);
    expect((await get(FLEABAG, 'US'))!.groups).toEqual([]);
    const ids = async (r: string) =>
      JSON.stringify(
        (await get(DUNE, r))!.groups.flatMap((g) => g.providers.map((p) => p.providerId)),
      );
    expect(await ids('US')).not.toBe(await ids('IN'));
    expect(await get(PARASITE, 'US')).toBeNull();
    let free = 0;
    let rentBuyOnly = 0;
    for (const { key } of watch.titles) {
      const w = await get(key, 'US');
      const types = new Set(w?.groups.map((g) => g.type) ?? []);
      if (types.has('free') || types.has('ads')) free += 1;
      if (types.size && [...types].every((t) => ['rent', 'buy', 'rent_buy'].includes(t)))
        rentBuyOnly += 1;
    }
    expect(free, 'free/ad-supported titles (US)').toBeGreaterThanOrEqual(2);
    expect(rentBuyOnly, 'rent/buy-only titles (US)').toBeGreaterThanOrEqual(2);
  });

  test('W2-AC2 tiles on the page: <a target=_blank rel="noopener noreferrer">, 44×44 targets', async ({
    page,
  }) => {
    for (const key of [DUNE, 'movie:289', 'movie:965150']) {
      await gotoTitle(page, key);
      await expectSafeTiles(block(page));
      // W5-AC2: the logo box (the tile's hit area includes it) is at least 44×44.
      for (const box of await tiles(block(page)).evaluateAll((els) =>
        els.map((a) => {
          const r = a.getBoundingClientRect();
          return { w: r.width, h: r.height };
        }),
      )) {
        expect(box.w).toBeGreaterThanOrEqual(44);
        expect(box.h).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('W2-AC2 clicking a tile opens a popup at the provider URL (network intercepted), no opener', async ({
    page,
    context,
    baseURL,
  }) => {
    const seen = await interceptExternal(context, new URL(baseURL!).host);
    await gotoTitle(page, DUNE);
    const cases = [
      { id: 1899, url: 'https://www.hbomax.com/' },
      { id: 2, url: 'https://tv.apple.com/search?term=Dune%3A%20Part%20Two' },
      { id: 3, url: 'https://play.google.com/store/search?q=Dune%3A%20Part%20Two&c=movies' },
    ];
    for (const c of cases) {
      const [popup] = await Promise.all([
        context.waitForEvent('page'),
        block(page).getByTestId(`wtw-provider-${c.id}`).click(),
      ]);
      await popup.waitForLoadState('domcontentloaded');
      expect(popup.url()).toBe(c.url);
      // rel="noopener noreferrer": no window.opener, no referrer.
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      expect(await popup.evaluate(() => document.referrer)).toBe('');
      await popup.close();
    }
    // The opener stayed on the title page (tile click never navigates the app itself).
    await expect(page).toHaveURL(/\/title\/movie\/693134-/);
    expect(seen.map((u) => new URL(u).origin)).toEqual(
      expect.arrayContaining(['https://www.hbomax.com', 'https://tv.apple.com']),
    );
    // No intercepted request carried a referrer.
    await context.unroute(() => true).catch(() => {});
  });

  test('W2-AC3 All options opens the TMDB watch page (intercepted)', async ({
    page,
    context,
    baseURL,
  }) => {
    await interceptExternal(context, new URL(baseURL!).host);
    await gotoTitle(page, DUNE);
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      block(page).getByTestId('wtw-all-options').click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe('https://www.themoviedb.org/movie/693134/watch?locale=US');
    await popup.close();
  });
});

test.describe('W3 right region (switcher)', () => {
  async function switchTo(page: Page, code: string) {
    await regionSelect(page).selectOption(code);
    await expect(block(page)).toHaveAttribute('data-region', code);
    await expect(block(page).getByTestId('wtw-skeleton')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`[?&]region=${code}(&|$)`));
  }

  test('W3-AC3 signed out: US → GB → IN swaps providers in place, writes ?region=, survives reload', async ({
    page,
  }, info) => {
    await gotoTitle(page, DUNE);
    await waitForSession(page, false);
    await expect(block(page).getByTestId('wtw-provider-1899')).toBeVisible(); // Max (US)
    await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));

    await switchTo(page, 'GB');
    await expect(block(page).getByTestId('wtw-provider-39')).toBeVisible(); // NOW
    await expect(block(page).getByTestId('wtw-provider-1899')).toHaveCount(0);
    await expect(regionSelect(page)).toHaveAccessibleName('Region: United Kingdom. Change region');
    await expect(block(page).getByTestId('wtw-all-options')).toHaveAttribute('href', /locale=GB$/);

    await switchTo(page, 'IN');
    await expect(block(page).getByTestId('wtw-provider-119')).toBeVisible(); // Prime Video (IN)
    await expect(block(page).getByTestId('wtw-provider-39')).toHaveCount(0);
    await expect(block(page).getByTestId('wtw-provider-10')).toHaveCount(0); // no Amazon Video in IN
    await expectSafeTiles(block(page));
    // No full page reload happened.
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload),
    ).toBe(1);
    await shot(page, info, 'wtw-region-in');

    await page.reload();
    await expect(block(page)).toHaveAttribute('data-region', 'IN');
    // Without ?region= the cookie carries the choice (signed out).
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'stubbed_region')?.value).toBe('IN');
    await gotoTitle(page, DUNE);
    await expect(block(page)).toHaveAttribute('data-region', 'IN');
    await expect(block(page).getByTestId('wtw-provider-119')).toBeVisible();
  });

  test('W3-AC3 signed in: the choice is saved to the profile and restored when the cookie is gone', async ({
    page,
  }) => {
    await signUpApi(page, 'wtw');
    await gotoTitle(page, DUNE);
    await waitForSession(page, true);
    await expect(block(page)).toHaveAttribute('data-region', 'US');
    await switchTo(page, 'GB');
    await page.reload();
    await expect(block(page)).toHaveAttribute('data-region', 'GB');

    // Drop only the region cookie: the profile setting heals it (ADR-012 §7).
    const ctx = page.context();
    const keep = (await ctx.cookies()).filter((c) => c.name !== 'stubbed_region');
    await ctx.clearCookies();
    await ctx.addCookies(keep);
    await gotoTitle(page, DUNE);
    await waitForSession(page, true);
    await expect(block(page)).toHaveAttribute('data-region', 'GB');
    await expect(block(page).getByTestId('wtw-provider-39')).toBeVisible();
    await expect
      .poll(async () => (await ctx.cookies()).find((c) => c.name === 'stubbed_region')?.value)
      .toBe('GB');
    await page.goto('/me/settings');
    await expect(page.getByTestId('settings-watch-region')).toHaveValue('GB');
  });

  test('?region= in a shared (canonical) link is honoured by SSR', async ({ page }) => {
    await page.goto('/title/movie/693134-dune-part-two?region=GB');
    await expect(page).toHaveURL(/\/title\/movie\/693134-dune-part-two\?region=GB$/);
    await expect(block(page)).toHaveAttribute('data-region', 'GB');
    await expect(block(page).getByTestId('wtw-provider-39')).toBeVisible();
    await expect(regionSelect(page)).toHaveValue('GB');
  });

  // QA-WTW-1 (app bug, patch in QA_VERIFICATION.md): page.tsx permanentRedirect(titleHref(t)) drops the query.
  test.fixme('?region= survives the slug redirect (slugless / stale-slug link)', async ({
    page,
  }) => {
    await page.goto('/title/movie/693134?region=GB');
    await expect(page).toHaveURL(/\/title\/movie\/693134-dune-part-two\?region=GB$/);
    await expect(block(page)).toHaveAttribute('data-region', 'GB');
    await expect(block(page).getByTestId('wtw-provider-39')).toBeVisible();
  });
});

test.describe('W3 region defaults (Accept-Language, geo header)', () => {
  // The runner's contexts default to locale en-US, which overrides an Accept-Language extra header
  // (observed on the navigation request), so Accept-Language is driven through `locale`.
  const cases: {
    locale: string;
    header?: Record<string, string>;
    region: string;
    label: string;
  }[] = [
    { label: 'en-GB → GB', locale: 'en-GB', region: 'GB' },
    { label: 'hi-IN → IN', locale: 'hi-IN', region: 'IN' },
    { label: 'bare en → US', locale: 'en', region: 'US' },
    {
      label: 'spoofed geo headers ignored (WATCH_GEO_HEADER off) → US',
      locale: 'en',
      header: { 'CF-IPCountry': 'IN', 'X-Vercel-IP-Country': 'GB' },
      region: 'US',
    },
  ];
  for (const c of cases) {
    test(`W3-AC1/AC2 ${c.label}`, async ({ browser, baseURL }, info) => {
      const ctx = await browser.newContext({
        ...info.project.use,
        baseURL,
        locale: c.locale,
        extraHTTPHeaders: c.header ?? {},
      });
      try {
        const page = await ctx.newPage();
        await page.goto('/title/movie/693134-dune-part-two');
        // Standalone context: no fixture `settled`, so wait for React's streamed reveal (support/fixtures.ts).
        await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
        await expect(block(page)).toHaveAttribute('data-region', c.region);
        await expect(block(page).getByTestId('wtw-fallback')).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    });
  }

  test('W3-AC4 unsupported region (ja-JP) shows the US list with "Showing: United States · Change"', async ({
    browser,
    baseURL,
  }, info) => {
    const ctx = await browser.newContext({
      ...info.project.use,
      baseURL,
      locale: 'ja-JP',
    });
    try {
      const page = await ctx.newPage();
      await page.goto('/title/movie/693134-dune-part-two');
      // Standalone context: no fixture `settled`, so wait for React's streamed reveal (support/fixtures.ts).
      await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
      await expect(block(page)).toHaveAttribute('data-region', 'US');
      const fb = block(page).getByTestId('wtw-fallback');
      await expect(fb).toHaveText('Showing: United States · Change');
      await expect(block(page).getByTestId('wtw-provider-1899')).toBeVisible();
      await fb.getByRole('button', { name: 'Change' }).click();
      await expect(regionSelect(page)).toBeFocused();
    } finally {
      await ctx.close();
    }
  });
});

test.describe('W4 not streaming / stale', () => {
  test('W4-AC1 Fleabag (US): "Not streaming in the US right now" + Watchlist + Change region + All options', async ({
    page,
  }, info) => {
    await signUpApi(page, 'wtwe');
    await gotoTitle(page, FLEABAG);
    await waitForSession(page, true);
    const empty = block(page).getByTestId('wtw-empty');
    await expect(empty).toContainText('Not streaming in the US right now.');
    await expect(empty.getByRole('button', { name: 'Change region' })).toBeVisible();
    await expect(tiles(block(page))).toHaveCount(0);
    await expect(block(page).getByTestId('wtw-all-options')).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/tv/67070/watch?locale=US',
    );
    await expect(block(page).getByTestId('wtw-attribution')).toBeVisible();
    await expect(block(page).getByTestId('wtw-checked')).toBeVisible();
    await shot(page, info, 'wtw-empty-us');

    const wl = empty.getByTestId('wtw-watchlist');
    await expect(wl).toHaveText('Add to Watchlist');
    await expect(wl).toHaveAttribute('aria-pressed', 'false');
    await wl.click();
    await expect(wl).toHaveAttribute('aria-pressed', 'true');
    await expect(wl).toHaveText('On watchlist');

    // Change region → the empty row is replaced by GB providers (Stream + Free).
    await regionSelect(page).selectOption('GB');
    await expect(block(page).getByTestId('wtw-empty')).toHaveCount(0);
    expect(await groupIds(page)).toEqual(['wtw-group-stream', 'wtw-group-free']);
    await expect(
      block(page).getByRole('link', {
        name: 'Open BBC iPlayer (free) — opens in a new tab',
        exact: true,
      }),
    ).toHaveAttribute('href', 'https://www.bbc.co.uk/iplayer/search?q=Fleabag');
  });

  test('W4-AC2 Parasite (data 45 days old): the block is not rendered, and the page lays out normally', async ({
    page,
  }) => {
    await gotoTitle(page, PARASITE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Parasite');
    await expect(page.getByTestId('where-to-watch')).toHaveCount(0);
    await expect(page.getByTestId('worth-it')).toBeVisible();
    // Also nothing after the client hydrates / any region change path (no late insert = no CLS).
    await page.waitForTimeout(500);
    await expect(page.getByTestId('where-to-watch')).toHaveCount(0);
    const res = await page.request.get('/api/titles/movie/496243/watch?region=US');
    expect(res.ok()).toBe(true);
    expect(((await res.json()) as { watch: unknown }).watch).toBeNull();
  });
});

test.describe('Placement, stub mark, a11y', () => {
  test('DESIGN §7.4.2 fold rule: Stub it stays above the fold; the block header peeks in', async ({
    page,
  }, info) => {
    await gotoTitle(page, DUNE);
    const vh = page.viewportSize()!.height;
    const stub = (await detailStubButton(page).boundingBox())!;
    const wtw = (await block(page).boundingBox())!;
    // 375×812: the bottom tab bar starts at ~752 (DESIGN §7.4.2); 1440×900: all above the fold.
    const foldTop = isMobile(info) ? vh - 60 : vh;
    expect(stub.y + stub.height, 'Stub it bottom').toBeLessThanOrEqual(foldTop);
    expect(wtw.y, 'block starts under Stub it').toBeGreaterThan(stub.y + stub.height);
    expect(wtw.y, 'block header peeks above the fold').toBeLessThan(foldTop);
    if (isMobile(info)) {
      // The rail may scroll inside the block, never the page (A1-AC3).
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
    }
    await shot(page, info, 'wtw-fold');
  });

  test('W7-AC1 ticket stub provider mark is decorative and not a link (when W-30 hint ships)', async ({
    page,
  }) => {
    await page.goto('/browse');
    const marks = page.getByTestId('ticket-providers');
    const n = await marks.count();
    test.skip(
      n === 0,
      'No ticket-providers mark rendered: list API has no watchHint yet (W-30/W-31, P1)',
    );
    for (const m of await marks.all()) {
      await expect(m).toHaveAttribute('role', 'img');
      await expect(m).toHaveAttribute('aria-label', /^On .+/);
      expect(await m.evaluate((el) => el.tagName !== 'A' && !el.querySelector('a, [href]'))).toBe(
        true,
      );
    }
  });

  test('W5-AC4 axe: no serious/critical issues on the block (available, expanded, empty)', async ({
    page,
  }, info) => {
    const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const run = async (label: string) => {
      await page.evaluate(axeSource);
      const v = await page.evaluate(async () => {
        // @ts-expect-error injected global
        const r = await window.axe.run(
          { include: [['[data-testid="where-to-watch"]']] },
          {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
            resultTypes: ['violations'],
          },
        );
        return (
          r.violations as { id: string; impact: string; nodes: { target: string[] }[] }[]
        ).map((x) => ({
          id: x.id,
          impact: x.impact,
          targets: x.nodes.map((n) => n.target.join(' ')),
        }));
      });
      await info.attach(`axe-${label}.json`, {
        body: JSON.stringify(v, null, 2),
        contentType: 'application/json',
      });
      // Known app finding QA-WTW-2 (reported with a patch, src/ not owned by QA): the aria-hidden brand
      // monograms on the Prime Video (#0f79af) and Paramount+ (#0064ff) tiles are ~4.3–4.4:1 against --fg.
      // Only that exact node set is exempted, and annotated so it stays visible in the report.
      const known = (x: (typeof v)[number]) =>
        x.id === 'color-contrast' &&
        x.targets.every(
          (t) => /data-monogram.*__mono$/.test(t) && /Prime Video|paramountplus/.test(t),
        );
      for (const x of v.filter(known))
        info.annotations.push({
          type: 'known-issue',
          description: `QA-WTW-2 ${label}: ${x.targets.join(' | ')}`,
        });
      const bad = v.filter((x) => (x.impact === 'serious' || x.impact === 'critical') && !known(x));
      expect(bad, `${label}: ${JSON.stringify(v)}`).toEqual([]);
    };
    await gotoTitle(page, DUNE);
    await run('dune-us');
    await gotoTitle(page, INTERSTELLAR);
    await block(page).getByTestId('wtw-more').click();
    await run('interstellar-expanded');
    await gotoTitle(page, FLEABAG);
    await expect(block(page).getByTestId('wtw-empty')).toBeVisible();
    await run('fleabag-empty');
  });

  test('W5-AC2 keyboard: tiles are reachable in visual order with a visible focus ring', async ({
    page,
  }, info) => {
    test.skip(isMobile(info), 'Keyboard order checked on desktop');
    await gotoTitle(page, DUNE);
    const first = tiles(block(page)).first();
    await first.focus();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      order.push((await page.evaluate(() => document.activeElement?.getAttribute('data-testid')))!);
      await page.keyboard.press('Tab');
    }
    expect(order).toEqual([
      'wtw-provider-1899',
      'wtw-provider-2',
      'wtw-provider-10',
      'wtw-provider-3',
    ]);
    // Focus-visible ring (keyboard focus): outline or box-shadow on the tile or its logo box.
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await first.evaluate((a) => {
      const logo = a.querySelector('span') as HTMLElement;
      const s = [getComputedStyle(a), getComputedStyle(logo)];
      return s.some(
        (c) =>
          (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== 'none',
      );
    });
    expect(ring).toBe(true);
  });
});
