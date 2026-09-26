/**
 * Epic A — browse, the >= 6.5 / vote-floor guarantee (A1, A7-AC5), sort (A2), type filter (A3),
 * "Load more" keyset paging, ticket contents (A1-AC1, A7, F2).
 */
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  shot,
  test,
  walkCatalog,
  type ApiTitle,
} from './support/fixtures';

/** Fixture titles that must never be listed (ADR-006 edge cases). */
const EXCLUDED = {
  'movie:8966': 'Twilight (TMDB 6.4, 13k votes)',
  'movie:11830': 'Tampopo (TMDB 8.0, 150 votes)',
  'movie:19908': 'Zombieland (TMDB 6.4, IMDb 7.5)',
  'tv:110382': 'Pachinko (TV 8.0, 99 votes)',
  'tv:34549': 'The Great British Bake Off (Reality)',
} as const;
/** Exactly-on-the-line titles that must be listed. */
const BOUNDARY_IN = {
  'movie:370755': 'Paterson (6.5 / 200)',
  'tv:96580': 'Emily in Paris (6.5 / 100)',
};

const SORTS = ['release_desc', 'release_asc', 'rating_desc', 'rating_asc'] as const;
type Sort = (typeof SORTS)[number];

/** Independent re-statement of ADR-003's total orders (not imported from src on purpose). */
function sortTitle(s: string) {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function cmp(a: string | number, b: string | number) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compare(sort: Sort, a: ApiTitle, b: ApiTitle): number {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const tail = cmp(sortTitle(a.title), sortTitle(b.title)) || cmp(a.key, b.key);
  switch (sort) {
    case 'release_desc':
      return cmp(b.releaseDate, a.releaseDate) || tail;
    case 'release_asc':
      return cmp(a.releaseDate, b.releaseDate) || tail;
    case 'rating_desc':
      return cmp(r1(b.voteAverage), r1(a.voteAverage)) || cmp(b.voteCount, a.voteCount) || tail;
    case 'rating_asc':
      return cmp(r1(a.voteAverage), r1(b.voteAverage)) || cmp(b.voteCount, a.voteCount) || tail;
  }
}

async function gridKeys(page: Page): Promise<string[]> {
  return page
    .locator(
      'main ul[aria-label="Titles"] article[data-ticket], main ul[aria-label="More titles"] article[data-ticket]',
    )
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket') ?? ''));
}

async function loadAll(page: Page) {
  const more = page.getByTestId('load-more');
  for (let i = 0; i < 10 && (await more.count()); i++) {
    const before = (await gridKeys(page)).length;
    await more.click();
    await expect.poll(async () => (await gridKeys(page)).length).toBeGreaterThan(before);
  }
  await expect(more).toHaveCount(0);
}

test.describe('A1 browse the curated catalogue', () => {
  test('API: every listed title clears TMDB 6.5 and the vote floor, for every sort and type', async ({
    page,
  }) => {
    for (const type of ['all', 'movie', 'tv']) {
      for (const sort of SORTS) {
        const { items, total } = await walkCatalog(page, { type, sort, limit: 7 });
        expect(items.length, `${type}/${sort} total`).toBe(total);
        expect(new Set(items.map((i) => i.key)).size, 'no duplicates across pages').toBe(total);
        for (const t of items) {
          expect(t.isListed).toBe(true);
          expect(Math.round(t.voteAverage * 10) / 10, t.title).toBeGreaterThanOrEqual(6.5);
          expect(t.voteCount, t.title).toBeGreaterThanOrEqual(t.mediaType === 'movie' ? 200 : 100);
          if (type !== 'all') expect(t.mediaType).toBe(type);
        }
        const keys = items.map((i) => i.key);
        for (const [k, why] of Object.entries(EXCLUDED)) expect(keys, why).not.toContain(k);
        if (type === 'all')
          for (const [k, why] of Object.entries(BOUNDARY_IN)) expect(keys, why).toContain(k);
      }
    }
  });

  test('grid shows ticket cards with poster, title, type, TMDB + IMDb scores and time; no excluded titles', async ({
    page,
  }, info) => {
    await page.goto('/browse');
    await expect(page.getByRole('heading', { level: 1, name: 'Browse' })).toBeVisible();
    const first = page.locator('main article[data-ticket]').first();
    await expect(first).toBeVisible();
    await expect(first.getByTestId('tmdb-rating')).toContainText('TMDB');
    await expect(first.getByTestId('ticket-time')).toHaveText(/^\d{4}/);
    await expect(first.getByRole('link')).toHaveAttribute('aria-label', /rated \d\.\d on TMDB/);
    await expect(first.locator('[data-fallback="true"], img').first()).toBeVisible(); // IMAGE_MODE=off → generated poster
    await expect(page.getByText(/\d+ titles · 6\.5\+ only/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, 'browse');

    await loadAll(page);
    const keys = await gridKeys(page);
    const api = await walkCatalog(page);
    expect(keys, 'UI order = API order, no dupes or gaps across Load more').toEqual(
      api.items.map((i) => i.key),
    );
    for (const k of Object.keys(EXCLUDED))
      await expect(page.getByTestId(`ticket-${k}`)).toHaveCount(0);
    for (const k of Object.keys(BOUNDARY_IN))
      await expect(page.getByTestId(`ticket-${k}`)).toHaveCount(1);
    await expect(
      page
        .getByText('That’s everything rated 6.5+.')
        .or(page.getByText("That's everything rated 6.5+.")),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('A7: IMDb chip + accessible name with both scores; hidden for Bluey (no IMDb id)', async ({
    page,
  }) => {
    await page.goto('/browse?sort=rating_desc&type=movie');
    const dune = page.getByTestId('ticket-movie:693134');
    await loadAll(page);
    await expect(dune.getByTestId('tmdb-rating')).toHaveText(/8\.1\s*TMDB/);
    await expect(dune.getByTestId('imdb-rating')).toContainText('8.5');
    await expect(dune.getByRole('link')).toHaveAttribute(
      'aria-label',
      'Dune: Part Two, movie, 2024, rated 8.1 on TMDB and 8.5 on IMDb',
    );
    await expect(dune.getByTestId('ticket-time')).toHaveText('2024 · 2H 46M');

    await page.goto('/browse?type=tv&sort=rating_desc');
    await loadAll(page);
    const bluey = page.getByTestId('ticket-tv:82728');
    await expect(bluey.getByTestId('tmdb-rating')).toContainText('8.6');
    await expect(bluey.getByTestId('imdb-rating')).toHaveCount(0);
    await expect(bluey).not.toContainText(/N\/A|IMDb 0/);
    await expect(bluey.getByRole('link')).toHaveAttribute(
      'aria-label',
      'Bluey, show, 2018, rated 8.6 on TMDB',
    );
    // F2: show time line; unknown episode length prints seasons only.
    await expect(bluey.getByTestId('ticket-time')).toHaveText('2018 · 3 SEASONS · ≈18H');
    await expect(page.getByTestId('ticket-tv:246').getByTestId('ticket-time')).toHaveText(
      '2005 · 3 SEASONS',
    );
    // Every ticket with an IMDb chip shows a real number, never 0 / N/A.
    const chips = await page.locator('main [data-testid="imdb-rating"]').allInnerTexts();
    for (const c of chips) expect(c).toMatch(/[1-9]\.\d/);
  });

  test('A7-AC5: Zombieland (TMDB 6.4, IMDb 7.5) never appears, not even via search', async ({
    page,
  }) => {
    const res = await page.request.get('/api/search?q=zombieland');
    const body = (await res.json()) as { items: unknown[]; notInCatalog: boolean };
    expect(body.items).toHaveLength(0);
    expect(body.notInCatalog).toBe(true);
    // Still reachable by URL (hysteresis rule D4 keeps unlisted rows addressable).
    await page.goto('/title/movie/19908');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zombieland');
  });
});

test.describe('A2 sort + A3 type filter', () => {
  for (const sort of SORTS) {
    test(`API order is a correct total order across pages: ${sort}`, async ({ page }) => {
      for (const type of ['all', 'movie', 'tv']) {
        const { items } = await walkCatalog(page, { sort, type, limit: 5 });
        const expected = [...items].sort((a, b) => compare(sort, a, b));
        expect(
          items.map((i) => i.key),
          `${type}/${sort}`,
        ).toEqual(expected.map((i) => i.key));
      }
    });
  }

  test('tie-breaks: rating ties by vote count desc then title; release ties by title', async ({
    page,
  }) => {
    const desc = (await walkCatalog(page, { sort: 'rating_desc', limit: 50 })).items;
    const at87 = desc.filter((t) => t.voteAverage === 8.7);
    expect(at87.length).toBeGreaterThan(3);
    for (let i = 1; i < at87.length; i++)
      expect(at87[i - 1]!.voteCount).toBeGreaterThanOrEqual(at87[i]!.voteCount);
    const asc = (await walkCatalog(page, { sort: 'rating_asc', limit: 50 })).items;
    expect(asc[0]!.voteAverage).toBe(6.5);
    // 6.5 tie: Paterson (200 votes) vs Emily in Paris (100 votes) → more votes first.
    expect(asc.slice(0, 2).map((t) => t.key)).toEqual(['movie:370755', 'tv:96580']);

    const rel = (await walkCatalog(page, { sort: 'release_desc', limit: 50 })).items.map(
      (t) => t.key,
    );
    // 2024-02-27: "Dune: Part Two" < "Shōgun"; 2023-07-19: "Barbie" < "Oppenheimer".
    expect(rel.indexOf('movie:693134')).toBe(rel.indexOf('tv:126308') - 1);
    expect(rel.indexOf('movie:346698')).toBe(rel.indexOf('movie:872585') - 1);
    const relAsc = (await walkCatalog(page, { sort: 'release_asc', limit: 50 })).items.map(
      (t) => t.key,
    );
    expect(relAsc[0]).toBe('movie:289'); // Casablanca 1942
    expect(relAsc.indexOf('movie:346698')).toBe(relAsc.indexOf('movie:872585') - 1);
  });

  test('sort control: 4 options, URL state, shareable link reproduces the view', async ({
    page,
  }, info) => {
    await page.goto('/browse');
    const select = page.getByTestId('sort-select');
    await expect(select.locator('option')).toHaveText([
      'Release date · newest',
      'Release date · oldest',
      'Rating · highest',
      'Rating · lowest',
    ]);
    await expect(select).toHaveValue('release_desc');
    for (const sort of ['rating_desc', 'rating_asc', 'release_asc', 'release_desc'] as const) {
      await select.selectOption(sort);
      if (sort === 'release_desc') await expect(page).toHaveURL(/\/browse$/);
      else await expect(page).toHaveURL(new RegExp(`[?&]sort=${sort}`));
      const expected = (await walkCatalog(page, { sort })).items.slice(0, 20).map((i) => i.key);
      await expect.poll(() => gridKeys(page)).toEqual(expected);
      if (sort.startsWith('rating'))
        await expect(page.getByText('Ties broken by vote count')).toBeVisible();
    }
    // A shared link reproduces the view (fresh page, no client state).
    await page.goto('/browse?type=tv&sort=rating_asc');
    await expect(page.getByTestId('sort-select')).toHaveValue('rating_asc');
    await expect(
      page.getByTestId('type-filter').getByRole('button', { name: 'Shows' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const expected = (await walkCatalog(page, { type: 'tv', sort: 'rating_asc' })).items;
    expect(await gridKeys(page)).toEqual(expected.slice(0, 20).map((i) => i.key));
    await shot(page, info, 'browse-shows-rating-asc');
  });

  test('type filter: All / Movies / Shows, reflected in the URL; shows sort by first-air date', async ({
    page,
  }) => {
    await page.goto('/browse');
    const seg = page.getByTestId('type-filter');
    await expect(seg.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    // The selected segment stays legible while hovered (sticky hover after a tap on touch).
    const all = seg.getByRole('button', { name: 'All' });
    await all.hover();
    const c = await all.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor];
    });
    expect(c[0], 'text colour differs from its background').not.toBe(c[1]);

    await seg.getByRole('button', { name: 'Movies' }).click();
    await expect(page).toHaveURL(/\/browse\?type=movie$/);
    await expect(seg.getByRole('button', { name: 'Movies' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await loadAll(page);
    const movies = await gridKeys(page);
    expect(movies.length).toBe((await walkCatalog(page, { type: 'movie' })).total);
    expect(movies.every((k) => k.startsWith('movie:'))).toBe(true);
    await expect(page.locator('main article[data-ticket]').first()).toContainText('MOVIE');

    await seg.getByRole('button', { name: 'Shows' }).click();
    await expect(page).toHaveURL(/\/browse\?type=tv$/);
    await loadAll(page);
    const shows = await gridKeys(page);
    expect(shows.every((k) => k.startsWith('tv:'))).toBe(true);
    const api = (await walkCatalog(page, { type: 'tv' })).items;
    expect(shows).toEqual(api.map((t) => t.key));
    // First-air dates, newest first (A3-AC2).
    const dates = api.map((t) => t.releaseDate);
    expect([...dates].sort().reverse()).toEqual(dates);

    await seg.getByRole('button', { name: 'All' }).click();
    await expect(page).toHaveURL(/\/browse$/);
  });

  test('Load more: link fallback carries the cursor; tampered cursor restarts at page 1', async ({
    page,
  }) => {
    await page.goto('/browse?sort=rating_desc');
    const href = await page.getByTestId('load-more').getAttribute('href');
    expect(href).toMatch(/^\/browse\?sort=rating_desc&cursor=/);
    const all = (await walkCatalog(page, { sort: 'rating_desc' })).items.map((i) => i.key);
    await page.goto(href!);
    expect(await gridKeys(page)).toEqual(all.slice(20, 40));

    await page.goto('/browse?sort=rating_desc&cursor=bm90LWEtY3Vyc29y');
    expect(await gridKeys(page)).toEqual(all.slice(0, 20));
    const res = await page.request.get('/api/catalog?cursor=%25%25garbage&sort=rating_desc');
    expect(res.status()).toBe(200);
    // Unknown sort/type in the page URL fall back to the defaults (the API answers 400 per contract §2).
    await page.goto('/browse?sort=nope&type=zzz');
    await expect(page.getByTestId('sort-select')).toHaveValue('release_desc');
  });

  test('home: hero, trending rail and browse grid with the same controls', async ({
    page,
  }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Only the good stuff');
    const rail = page.locator('ol[aria-label="Trending this week"]');
    await expect(rail.locator('article[data-ticket]')).toHaveCount(10);
    // Rail stubs also carry TMDB + IMDb (A7-AC1).
    await expect(rail.locator('[data-testid="tmdb-rating"]').first()).toBeVisible();
    await expect(rail.locator('[data-testid="imdb-rating"]').first()).toBeVisible();
    await page.getByTestId('sort-select').selectOption('rating_desc');
    await expect(page).toHaveURL(/\/\?sort=rating_desc$/);
    await expect(
      page.locator('main ul[aria-label="Titles"] article[data-ticket]').first(),
    ).toHaveAttribute('data-ticket', 'tv:1396'); // Breaking Bad 8.9
    await expectNoHorizontalScroll(page);
    await page.goto('/');
    await shot(page, info, 'home');
  });
});
