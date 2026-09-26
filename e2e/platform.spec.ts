/**
 * Epic E + cross-cutting: zero console errors and no horizontal scroll on every screen (A1-AC3),
 * demo pill + attribution (E1/E2), keyboard navigation and reduced motion (E4), axe WCAG 2.1 A/AA scan
 * (E4, A5-AC2 contrast), zero outbound network from the server (ADR-006 §4), security (E5).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  isMobile,
  shot,
  signInApi,
  signUpApi,
  test,
  waitForSession,
} from './support/fixtures';

const PUBLIC_PAGES = [
  '/',
  '/browse',
  '/browse?type=tv&sort=rating_desc',
  '/search',
  '/search?q=dune',
  '/search?q=twilight',
  '/title/movie/693134-dune-part-two',
  '/title/tv/82728-bluey',
  '/title/tv/76331-succession',
  '/title/movie/8966-twilight',
  '/title/movie/19908-zombieland',
  '/u/dev',
  '/u/dev?tab=diary',
  '/u/dev?tab=reviews',
  '/about',
  '/signin',
  '/signup',
];

test.describe('every screen', () => {
  test('signed out: loads clean (no console errors, no third-party requests, no sideways scroll), demo pill + attribution', async ({
    page,
  }) => {
    for (const url of PUBLIC_PAGES) {
      await page.goto(url);
      await expect(page.getByTestId('demo-pill'), url).toBeVisible();
      await expect(page.locator('footer')).toContainText(
        'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      );
      await expect(page.locator('footer')).toContainText('IMDb ratings via OMDb');
      await expect(page.locator('footer img[alt="TMDB"]')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expect(page.locator('h1'), `${url} has one h1`).toHaveCount(1);
    }
  });

  test('signed in: owner screens load clean too', async ({ page }, info) => {
    const acc = await signUpApi(page, 'pl');
    await page.request.post('/api/stubs', { data: { mediaType: 'movie', tmdbId: 693134 } });
    for (const url of [
      '/',
      '/me/stubs',
      '/me/settings',
      `/u/${acc.handle}`,
      `/u/${acc.handle}?tab=watchlist`,
      '/title/movie/693134',
    ]) {
      await page.goto(url);
      await waitForSession(page, true);
      await expectNoHorizontalScroll(page);
    }
    await page.goto('/me/settings');
    await shot(page, info, 'settings');
  });

  test('screenshots of key screens', async ({ page, allowConsole }, info) => {
    allowConsole.push(/status of 404/);
    await page.goto('/about');
    await shot(page, info, 'about');
    await page.goto('/nope-not-here');
    await shot(page, info, '404');
    await page.goto('/title/movie/8966-twilight');
    await shot(page, info, 'title-hysteresis');
    await page.goto('/title/movie/1858-transformers');
    await page.getByTestId('worth-it').scrollIntoViewIfNeeded();
    await shot(page, info, 'worth-it-split');
    await page.goto('/signin');
    await shot(page, info, 'signin');
    if (isMobile(info)) {
      await page.goto('/browse');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await shot(page, info, 'tabbar');
    }
  });
});

test.describe('mobile shell', () => {
  test('bottom tab bar: Discover · Search · Wallet (badge) · You; auth opens as a bottom sheet', async ({
    page,
  }, info) => {
    test.skip(!isMobile(info), 'The tab bar is the < 900 px navigation.');
    await page.goto('/browse');
    const bar = page
      .getByRole('navigation', { name: 'Primary' })
      .filter({ hasText: 'Wallet' })
      .last();
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link')).toHaveText(['Discover', 'Search', 'Wallet', 'You']);
    await expect(bar.getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(bar.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
      'href',
      '/signin?next=/me/stubs',
    );
    for (const l of await bar.getByRole('link').all()) {
      const b = (await l.boundingBox())!;
      expect(b.height, 'touch target').toBeGreaterThanOrEqual(44);
    }
    // Header desktop nav is hidden at 375 px.
    await expect(page.locator('header').getByRole('link', { name: 'Browse' })).toBeHidden();

    await page.getByRole('link', { name: 'Sign in' }).first().click();
    const sheet = page.getByTestId('auth-sheet');
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(vh - 2); // anchored to the bottom
    await shot(page, info, 'auth-sheet');
    await page.keyboard.press('Escape');

    const acc = await signUpApi(page, 'tb');
    await page.request.post('/api/stubs', { data: { mediaType: 'movie', tmdbId: 129 } });
    await page.reload();
    await expect(bar.locator('[data-wallet-badge]')).toHaveText('1');
    await bar.getByRole('link', { name: /Wallet/ }).click();
    await expect(page).toHaveURL(new RegExp(`/u/${acc.handle}$`));
    await bar.getByRole('link', { name: 'You' }).click();
    await expect(page).toHaveURL(/\/me\/settings$/);
  });
});

test.describe('E4 keyboard + motion', () => {
  test('skip link, tab to a ticket, Enter opens it; Stub it reachable; Esc closes the auth sheet', async ({
    page,
  }, info) => {
    test.skip(isMobile(info), 'Hardware keyboard flow is checked on desktop.');
    await page.goto('/browse');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();

    // Tab forward until the first ticket link has focus.
    const first = page.locator('main ul[aria-label="Titles"] article[data-ticket] a').first();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      if (await first.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(first).toBeFocused();
    // The ring is drawn on the ticket wrapper (.tw:has(.body:focus-visible)).
    const outline = await first.evaluate((el) => {
      const s = getComputedStyle(el.closest('article')!.parentElement!);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(outline, 'visible focus ring').not.toMatch(/^none 0px none$/);
    const href = await first.getAttribute('href');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    const cta = page.locator('main').getByRole('button', { name: 'Stub it' });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await cta.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(cta).toBeFocused();
    await page.keyboard.press('Enter'); // signed out → auth sheet
    const sheet = page.getByTestId('auth-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(':focus')).toHaveCount(1); // focus moved into the dialog
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(cta).toBeFocused(); // focus returns to the trigger
  });

  test('every interactive element has an accessible name; images have alt', async ({ page }) => {
    for (const url of ['/', '/title/movie/693134', '/u/dev', '/signin', '/search?q=the']) {
      await page.goto(url);
      const unnamed = await page.evaluate(() => {
        const out: string[] = [];
        document
          .querySelectorAll('a[href], button, input, select, textarea, [role="button"]')
          .forEach((el) => {
            const h = el as HTMLElement;
            if (h.closest('[hidden], [aria-hidden="true"], dialog:not([open])')) return;
            const labelled =
              h.getAttribute('aria-label') ||
              h.getAttribute('aria-labelledby') ||
              (h as HTMLInputElement).labels?.length ||
              h.getAttribute('title') ||
              (h.textContent ?? '').trim() ||
              h.querySelector('img[alt]:not([alt=""])') ||
              (h as HTMLInputElement).type === 'hidden';
            if (!labelled) out.push(h.outerHTML.slice(0, 120));
          });
        document
          .querySelectorAll('img:not([alt])')
          .forEach((i) => out.push(`img without alt: ${i.outerHTML.slice(0, 120)}`));
        return out;
      });
      expect(unnamed, url).toEqual([]);
    }
  });

  test('prefers-reduced-motion collapses animations and transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/browse');
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll('main *')].slice(0, 400).map((el) => {
        const s = getComputedStyle(el);
        return [s.transitionDuration, s.animationDuration].join(',');
      }),
    );
    const slow = durations.filter((d) => d.split(/,\s*/).some((x) => parseFloat(x) > 0.01));
    expect(slow).toEqual([]);
  });
});

test.describe('axe WCAG 2.1 A/AA scan', () => {
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  async function axe(page: Page) {
    await page.evaluate(axeSource);
    return page.evaluate(async () => {
      // @ts-expect-error injected global
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations'],
      });
      return (
        r.violations as {
          id: string;
          impact: string;
          nodes: { target: string[]; failureSummary: string }[];
        }[]
      ).map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
    });
  }

  const pages = [
    '/',
    '/browse',
    '/search?q=dune',
    '/title/movie/693134-dune-part-two',
    '/title/tv/82728-bluey',
    '/title/tv/76331-succession',
    '/u/dev',
    '/u/dev?tab=diary',
    '/signin',
    '/signup',
    '/about',
  ];
  for (const url of pages) {
    test(`no serious/critical violations: ${url}`, async ({ page }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // settle transitions for contrast checks
      await page.goto(url);
      const violations = await axe(page);
      await info.attach('axe.json', {
        body: JSON.stringify(violations, null, 2),
        contentType: 'application/json',
      });
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }

  test('no serious/critical violations: signed-in title page with composer, /me/stubs, settings', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signUpApi(page, 'ax');
    await page.request.post('/api/stubs', { data: { mediaType: 'tv', tmdbId: 2316 } });
    for (const url of ['/title/tv/2316-the-office', '/me/stubs', '/me/settings']) {
      await page.goto(url);
      await waitForSession(page, true);
      const bad = (await axe(page)).filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(bad, `${url}: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
    }
  });
});

test.describe('E5 security + ADR-006 zero network', () => {
  test('the demo server makes no outbound network requests', async ({ page }, info) => {
    const log = path.resolve(__dirname, '../.data/e2e-net.jsonl');
    test.skip(
      !fs.existsSync(log),
      'Server was not started with the QA net guard (see playwright.config.ts).',
    );
    // Exercise every server path: pages, reads, auth, writes, export.
    for (const url of [
      '/',
      '/browse?sort=rating_asc',
      '/search?q=shogun',
      '/title/movie/693134',
      '/title/tv/82728',
      '/u/maya',
      '/about',
    ]) {
      await page.goto(url);
    }
    await signUpApi(page, 'nw');
    await page.request.post('/api/stubs', { data: { mediaType: 'movie', tmdbId: 603 } });
    await page.request.put('/api/reviews', {
      data: { mediaType: 'movie', tmdbId: 603, rating10: 8 },
    });
    await page.request.put('/api/watchlist/movie/129', { data: {} });
    await page.request.get('/api/me/export?format=json');
    await page.request.post('/api/auth/magic-link', { data: { email: 'someone@e2e.test' } });
    await page.goto('/me/stubs');
    const entries = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { kind: string; host?: string; argv: string });
    expect(entries.some((e) => e.kind === 'armed' && /next(-server)?|start/.test(e.argv))).toBe(
      true,
    );
    const outbound = entries.filter((e) => e.kind !== 'armed');
    await info.attach('net-log.json', {
      body: JSON.stringify(entries, null, 2),
      contentType: 'application/json',
    });
    expect(outbound, 'outbound connections / DNS lookups from the server').toEqual([]);
  });

  test('security headers, no secrets in client JS, HTML is never executed', async ({ page }) => {
    const res = await page.request.get('/');
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    await page.goto('/title/movie/693134');
    const scripts = await page
      .locator('script[src]')
      .evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      const js = await (await page.request.get(src)).text();
      expect(js, src).not.toMatch(
        /stubbed-demo-mode-not-a-secret|DEMO_SESSION_SECRET|SUPABASE_SERVICE_ROLE|TMDB_READ_TOKEN|OMDB_API_KEY|passwordHash|scrypt\$/,
      );
    }
    // Session cookie is httpOnly (not readable from JS).
    await signInApi(page, 'priya@demo.stubbed.app');
    await page.reload();
    expect(await page.evaluate(() => document.cookie)).not.toContain('stubbed_demo_session');
    const cookie = (await page.context().cookies()).find((c) => c.name === 'stubbed_demo_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    // Cross-origin mutation is refused.
    const csrf = await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 603 },
      headers: { origin: 'https://evil.example' },
    });
    expect(csrf.status()).toBe(403);
  });

  test('rate limit: 30 stubs per minute, then 429 with Retry-After', async ({ page }) => {
    await signUpApi(page, 'rl');
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await page.request.post('/api/stubs', { data: { mediaType: 'movie', tmdbId: 13 } });
      codes.push(r.status());
      if (r.status() === 429) expect(Number(r.headers()['retry-after'])).toBeGreaterThan(0);
    }
    expect(codes.slice(0, 30).every((c) => c === 201)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
