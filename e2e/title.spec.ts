/**
 * A5 title detail, A6 read reviews, A7 IMDb on detail, A8 community rating, Epic F "Worth it?",
 * F5 link previews, D3 (no third-party posting UI), 404s.
 */
import type { Page } from '@playwright/test';
import { expect, gotoTitle, shot, test } from './support/fixtures';

const worthIt = (page: Page) => page.getByTestId('worth-it');

test.describe('A5 title detail', () => {
  test('Dune: Part Two shows every detail field, TMDB + IMDb + Stubbed chips, no blended score', async ({
    page,
  }, info) => {
    await gotoTitle(page, 'movie:693134');
    const main = page.locator('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dune: Part Two');
    await expect(main.locator('.eyebrow').first()).toHaveText(/movie · 2024 · 2h 46m/i);
    await expect(main.getByRole('list', { name: 'Genres' })).toContainText('Science Fiction');
    await expect(main.getByText('Denis Villeneuve')).toBeVisible();
    await expect(main.getByText('Timothée Chalamet')).toBeVisible();
    await expect(main.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute(
      'href',
      /youtube\.com\/watch\?v=/,
    );
    await expect(main.getByText(/Paul Atreides joins the Fremen and Chani/)).toBeVisible();
    await expect(main.locator('[data-fallback="true"]').first()).toBeVisible(); // generated poster

    const chips = main.getByRole('list', { name: 'Ratings' });
    const tmdb = chips.getByTestId('tmdb-rating');
    await expect(tmdb).toContainText('8.1');
    await expect(tmdb).toContainText('7.4k votes');
    const imdb = chips.getByTestId('imdb-rating');
    await expect(imdb).toContainText('8.5');
    await expect(imdb).toContainText('690k votes');
    await expect(imdb).toContainText('IMDb rating · via OMDb');
    const out = imdb.getByRole('link', { name: 'Open on IMDb (new tab)' });
    await expect(out).toHaveAttribute('href', 'https://www.imdb.com/title/tt15239678/');
    await expect(out).toHaveAttribute('target', '_blank');
    await expect(out).toHaveAttribute('rel', /noopener/);
    // A8-AC1: 5 seed ratings (9, 8, 10, 8, 7) → mean 8.4.
    const stubbed = chips.getByTestId('stubbed-rating');
    await expect(stubbed).toContainText('8.4');
    await expect(stubbed).toContainText('5 ratings');
    // F3-AC3: nothing prints a blended number (mean of TMDB+IMDb = 8.3, of all three = 8.3).
    await expect(chips).not.toContainText('8.3');
    await expect(worthIt(page)).not.toContainText(/\b\d\.\d\b/);
    await shot(page, info, 'title-dune');
    await shot(page, info, 'title-dune-full', true);
  });

  test('Bluey (no IMDb id): IMDb chip and link hidden, never 0 / N/A; no Stubbed chip with 0 ratings', async ({
    page,
  }, info) => {
    await gotoTitle(page, 'tv:82728');
    const chips = page.getByRole('list', { name: 'Ratings' });
    await expect(chips.getByTestId('tmdb-rating')).toContainText('8.6');
    await expect(page.getByTestId('imdb-rating')).toHaveCount(0);
    await expect(chips).not.toContainText(/IMDb|N\/A/);
    await expect(page.getByRole('link', { name: /Open on IMDb/ })).toHaveCount(0);
    await expect(page.getByTestId('stubbed-rating')).toHaveCount(0);
    await expect(page.locator('main .eyebrow').first()).toHaveText(/show · 2018 · 3 seasons/i);
    await expect(page.getByText('Joe Brumm')).toBeVisible();
    // A6-AC3 empty state with CTA.
    await expect(page.getByText('No reviews yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Be the first to review' })).toBeVisible();
    await shot(page, info, 'title-bluey');
  });

  test('A8-AC1: 1–4 ratings read "N ratings · average unlocks at 5"', async ({ page }) => {
    await gotoTitle(page, 'movie:666277'); // Past Lives: 1 seed rating
    const chip = page.getByTestId('stubbed-rating');
    await expect(chip).toContainText(/^1\s*STUBBED\s*rating · average unlocks at 5$/);
    // Stubbed only counts toward the verdict with 5+ ratings (F3-AC2).
    await expect(page.getByTestId('worth-it-verdict')).toContainText('Based on TMDB and IMDb');
  });

  test('wrong slug lands on the canonical URL; unknown ids and routes show the 404 page', async ({
    page,
    allowConsole,
  }) => {
    allowConsole.push(/status of 404/); // the browser logs every real 404 document
    // ADR-013 C-03: existence and slug checks run before <Suspense>, so the status is real (308/404);
    // exact codes by the request API are in e2e/seo-status.spec.ts.
    await page.goto('/title/movie/693134-wrong-slug');
    await expect(page).toHaveURL(/\/title\/movie\/693134-dune-part-two$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dune: Part Two');

    for (const url of ['/title/movie/999999999', '/title/film/603', '/u/nobody_here', '/nope']) {
      const r = await page.goto(url);
      expect(r?.status(), url).toBe(404);
      await expect(page.getByTestId('not-found')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        "This ticket doesn't exist",
      );
      await expect(
        page.getByTestId('not-found').getByRole('link', { name: 'Back to Discover' }),
      ).toHaveAttribute('href', '/');
    }
    await page.getByTestId('not-found').getByRole('link', { name: 'Back to Discover' }).click();
    await expect(page.getByTestId('sort-select')).toBeVisible(); // Discover hosts the browse grid
  });

  test('A5-AC2: the background is tinted from the poster palette and follows client navigation', async ({
    page,
  }) => {
    const palette = async (q: string, key: string) => {
      const r = await page.request.get(`/api/search?q=${encodeURIComponent(q)}`);
      const items = (
        (await r.json()) as { items: { key: string; palette: { tint1: string; tint2: string } }[] }
      ).items;
      return items.find((i) => i.key === key)!.palette;
    };
    const dune = await palette('dune', 'movie:693134');
    const inter = await palette('interstellar', 'movie:157336');
    const frontTint = () =>
      page.evaluate(() => {
        const layers = [...document.querySelectorAll<HTMLElement>('[style*="--t1"]')];
        const front =
          layers.find((l) => getComputedStyle(l.parentElement!).opacity === '1') ?? layers[0];
        return front?.style.getPropertyValue('--t1');
      });
    await gotoTitle(page, 'movie:693134');
    expect(await frontTint()).toBe(dune.tint1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', dune.tint2);
    // "If you liked Interstellar" → client navigation cross-fades to the new palette.
    await page.getByTestId('worth-it-like').getByRole('link').click();
    await expect(page).toHaveURL(/\/title\/movie\/157336-interstellar$/);
    await expect.poll(frontTint).toBe(inter.tint1);
  });

  test('A5-AC3 / F5: title, description and og:description read "{hook} {time} · {verdict}" (≤160)', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:693134');
    await expect(page).toHaveTitle('Dune: Part Two (2024) · Stubbed');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    const og = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(desc).toBe(og);
    expect(desc!.length).toBeLessThanOrEqual(160);
    expect(desc).toMatch(/^Paul Atreides .+ 2H 46M · Widely loved$/i);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Dune: Part Two (2024)',
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      'content',
      'video.movie',
    );
    // IMAGE_MODE=off (E2E) renders generated posters, so there is no poster URL for og:image.
  });

  test('hysteresis: Twilight is reachable by URL, flagged below 6.5, verdict "Mixed reviews"', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:8966');
    await expect(page.locator('main').getByRole('note')).toHaveText(
      'This title dropped below our 6.5 bar. Your stubs are safe.',
    );
    await expect(page.getByTestId('ticket-movie:8966')).toContainText('BELOW 6.5 NOW');
    await expect(page.getByTestId('worth-it-verdict')).toContainText('Mixed reviews');
  });
});

test.describe('F "Worth it?"', () => {
  test('F1: slip sits under the action row; lines in order; limits hold', async ({ page }) => {
    await gotoTitle(page, 'movie:693134');
    const slip = worthIt(page);
    await expect(slip.getByRole('heading', { name: 'Worth it?' })).toBeVisible();
    // Directly under the action row (the stub line is the last element of that row).
    const prevIsActionRow = await slip.evaluate((el) => {
      let p = el.previousElementSibling;
      // DESIGN §7.4.2: "Where to watch" sits between the stubbed line and the slip.
      while (p && p.matches('[data-testid="my-rating"], [data-testid="where-to-watch"]'))
        p = p.previousElementSibling;
      return p?.getAttribute('data-testid') === 'stub-count';
    });
    expect(prevIsActionRow).toBe(true);
    const order = await slip.evaluate((el) =>
      [...el.querySelectorAll('[data-testid^="worth-it-"]')].map((e) =>
        e.getAttribute('data-testid'),
      ),
    );
    expect(order).toEqual([
      'worth-it-hook',
      'worth-it-vibes',
      'worth-it-time',
      'worth-it-cert',
      'worth-it-verdict',
      'worth-it-like',
    ]);
    const hook = (await slip.getByTestId('worth-it-hook').textContent())!;
    expect(hook.length).toBeLessThanOrEqual(120);
    expect(hook).not.toContain('FROM TMDB'); // hand-written hook: no label (F1-AC4)
    expect(await slip.getByTestId('worth-it-vibes').locator('li').count()).toBeLessThanOrEqual(3);
    await expect(slip.getByTestId('worth-it-time')).toContainText('2H 46M · LONG ONE');
    await expect(slip.getByTestId('worth-it-cert')).toHaveText('PG-13');
    const word = await slip.getByTestId('worth-it-verdict').locator('p').first().textContent();
    expect(word!.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
    await expect(slip.getByTestId('worth-it-verdict')).toContainText(
      'Based on TMDB, IMDb and 5 Stubbed ratings',
    );
    await expect(slip.getByTestId('worth-it-like').getByRole('link')).toHaveCount(1);
  });

  test('F1-AC4: TMDB-sourced hooks are labelled; missing certification line is hidden', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:238'); // The Godfather: no hand-written hook → tagline
    await expect(page.getByTestId('worth-it-hook')).toContainText('FROM TMDB');
    await gotoTitle(page, 'movie:370755'); // Paterson
    await expect(page.getByTestId('worth-it-hook')).toContainText('FROM TMDB');
    await gotoTitle(page, 'movie:346'); // Seven Samurai: no certification
    await expect(page.getByTestId('worth-it-cert')).toHaveCount(0);
    await expect(page.getByTestId('worth-it-time')).toBeVisible();
    await gotoTitle(page, 'tv:246'); // Avatar: unknown episode length → no per-episode / total
    await expect(page.getByTestId('worth-it-time')).not.toContainText('≈');
  });

  test('F3-AC4: one fixture per verdict, split opinions explained in words', async ({ page }) => {
    const cases: [string, string, RegExp?][] = [
      ['movie:693134', 'Widely loved'],
      ['movie:329865', 'Well liked'],
      ['movie:346698', 'Solid pick'],
      ['movie:1858', 'Split opinions', /rates it higher than/],
      ['movie:8966', 'Mixed reviews'],
    ];
    for (const [key, word, note] of cases) {
      await gotoTitle(page, key);
      const v = page.getByTestId('worth-it-verdict');
      await expect(v.locator('p').first()).toContainText(word);
      if (note) await expect(v).toContainText(note);
      await expect(v).not.toContainText(/\d\.\d/);
    }
    await gotoTitle(page, 'tv:82728');
    await expect(page.getByTestId('worth-it-verdict')).toContainText('Based on TMDB');
    await expect(page.getByTestId('worth-it-verdict')).not.toContainText('IMDb');
  });
});

test.describe('A6 read reviews', () => {
  test('Stubbed reviews list (avatar, handle, stars, date, text), sort by highest, TMDB tab', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:693134');
    const cards = page.getByTestId('review-card');
    await expect(cards).toHaveCount(5);
    const maya = cards.filter({ hasText: '@maya' });
    await expect(maya.getByRole('link', { name: '@maya' })).toHaveAttribute('href', '/u/maya');
    await expect(maya.getByRole('img', { name: '4.5 out of 5 stars' })).toBeVisible();
    await expect(maya.locator('time')).toHaveText('Sep 12, 2026');
    await expect(maya).toContainText('STUB #2');
    await expect(maya).toContainText('EDITED');
    await expect(maya).toContainText('tragedy wearing a blockbuster');

    await page.getByLabel('Sort reviews').selectOption('highest');
    await expect(cards.first()).toContainText('@sam');
    await expect(cards.first().getByRole('img', { name: '5 out of 5 stars' })).toBeVisible();

    await page.getByRole('button', { name: 'From TMDB · 2' }).click();
    await expect(page.getByTestId('tmdb-review-card')).toHaveCount(2);
    await expect(page.getByTestId('tmdb-review-card').first()).toContainText('TMDB review');
    await expect(page.getByText('Reviews from TMDB community members. Read-only.')).toBeVisible();
  });

  test('A6-AC2: spoiler review is blurred and hidden from AT until "Show spoiler"', async ({
    page,
  }, info) => {
    await gotoTitle(page, 'tv:76331'); // Succession, priya's spoiler review
    const card = page.getByTestId('review-card').filter({ hasText: '@priya' });
    const body = card.locator('[data-spoiler]');
    await expect(body).toHaveAttribute('data-spoiler', 'hidden');
    await expect(body).toHaveAttribute('aria-hidden', 'true');
    const filter = await body.evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('blur');
    await card.getByTestId('spoiler-toggle').scrollIntoViewIfNeeded();
    await shot(page, info, 'spoiler-blurred');
    await card.getByTestId('spoiler-toggle').click();
    await expect(body).toHaveAttribute('data-spoiler', 'shown');
    await expect(body).not.toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => body.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    await expect(card.getByTestId('spoiler-toggle')).toHaveCount(0);
  });
});

test.describe('D3 no third-party posting (ADR-008)', () => {
  test('no "post on IMDb/Trakt/TMDB" UI, test ids or routes anywhere', async ({ page }) => {
    const bad =
      /post (it )?(on|to) (imdb|trakt|tmdb)|also post|share to imdb|sync (with|to) trakt/i;
    for (const url of ['/', '/title/movie/693134', '/title/tv/1396', '/about', '/signin']) {
      await page.goto(url);
      // Explanatory copy ("Why we can't post to IMDb for you" on /about) is fine; controls are not.
      const controls = page.locator('button, a, input, label, [role="switch"], [role="checkbox"]');
      expect(await controls.filter({ hasText: bad }).count(), url).toBe(0);
      await expect(
        page.locator('[data-testid="imdb-assist"], [data-testid*="sync"], [data-testid*="trakt"]'),
      ).toHaveCount(0);
    }
    for (const p of [
      '/api/reviews/imdb',
      '/api/sync',
      '/api/trakt',
      '/api/me/sync',
      '/api/imdb-assist',
    ]) {
      expect([404, 405], p).toContain((await page.request.get(p)).status());
    }
    // The composer (signed-in) says reviews stay on Stubbed and offers no outbound checkbox.
    const body = await (await page.request.get('/title/movie/693134')).text();
    expect(body).not.toMatch(/imdb_shared_at|imdb-assist|trakt/i);
  });
});
