/** A4 — search inside the curated catalogue (partial, case- and accent-insensitive; "Not in Stubbed"). */
import { expect, isMobile, shot, test } from './support/fixtures';

test.describe('A4 search', () => {
  test('API: partial, case- and accent-insensitive, listed titles only', async ({ page }) => {
    const q = async (s: string) =>
      (await (await page.request.get(`/api/search?q=${encodeURIComponent(s)}`)).json()) as {
        items: { key: string; title: string; year: number; mediaType: string }[];
        notInCatalog: boolean;
      };
    expect((await q('shogun')).items.map((i) => i.key)).toContain('tv:126308');
    expect((await q('AMELIE')).items.map((i) => i.key)).toContain('movie:194');
    expect((await q('Amélie')).items.map((i) => i.key)).toContain('movie:194');
    const spider = (await q('spider')).items.map((i) => i.key);
    expect(spider).toEqual(expect.arrayContaining(['movie:324857', 'movie:569094']));
    expect((await q('bReAkInG')).items[0]?.key).toBe('tv:1396');
    for (const out of ['twilight', 'tampopo', 'pachinko', 'bake off', 'zombieland']) {
      const r = await q(out);
      expect(r.items, out).toHaveLength(0);
      expect(r.notInCatalog, out).toBe(true);
    }
  });

  test('search page: results show year + type; type filter; "Not in Stubbed" empty state', async ({
    page,
  }, info) => {
    if (isMobile(info)) {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Search' })
        .click();
      await expect(page).toHaveURL(/\/search$/);
    } else {
      await page.goto('/search');
    }
    const input = page.getByTestId('search-input').last();
    await expect(input).toBeFocused();
    await input.fill('shogun');
    await expect(page).toHaveURL(/\/search\?q=shogun$/);
    const hit = page.getByTestId('ticket-tv:126308');
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('Shōgun');
    await expect(hit).toContainText('SHOW');
    await expect(hit.getByTestId('ticket-time')).toContainText('2024');
    await expect(page.getByText(/1 RESULT FOR “SHOGUN”/)).toBeVisible();
    await shot(page, info, 'search');

    await page.goto('/search?q=the');
    const tv = page.getByTestId('type-filter').getByRole('link', { name: 'Shows' });
    await tv.click();
    await expect(page).toHaveURL(/\/search\?q=the&type=tv$/);
    const keys = await page
      .locator('main article[data-ticket]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k?.startsWith('tv:'))).toBe(true);

    await page.goto('/search?q=Twilight');
    const empty = page.getByTestId('not-in-catalog');
    await expect(empty).toContainText('Not in Stubbed');
    await expect(empty).toContainText('We only list titles rated 6.5+');
    await expect(page.locator('main article[data-ticket]')).toHaveCount(0);
    await shot(page, info, 'search-not-in-stubbed');
  });

  test('desktop header combobox: suggestions, keyboard, miss copy, see-all', async ({
    page,
  }, info) => {
    test.skip(isMobile(info), 'The header search is desktop-only (mobile uses the Search tab).');
    await page.goto('/browse');
    const box = page.getByRole('combobox', { name: 'Search titles' });
    await box.fill('amelie');
    const list = page.getByRole('listbox', { name: 'Search suggestions' });
    const opt = list.getByRole('option', { name: /Amélie/ });
    await expect(opt).toBeVisible();
    await expect(opt).toContainText('2001 · Movie');
    await box.press('ArrowDown');
    await expect(opt).toHaveAttribute('aria-selected', 'true');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/title\/movie\/194-amelie$/);

    await box.fill('twilight');
    await expect(list.getByText('Not in Stubbed — we only list titles rated 6.5+.')).toBeVisible();
    await box.press('Escape');
    await expect(list).toBeHidden();
    await box.fill('dune');
    await expect(list.getByRole('option', { name: /Dune: Part Two/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=dune$/);
    await expect(page.getByTestId('ticket-movie:693134')).toBeVisible();
  });
});
