/**
 * C-Q7 brand from config (ADR-013 C-15): the header, document title and copy use NEXT_PUBLIC_BRAND_NAME
 * (inlined at build time). Default build → "Stubbed". To check a renamed build, build + start with
 * NEXT_PUBLIC_BRAND_NAME=Reel and run this spec with E2E_BRAND_NAME=Reel E2E_BASE_URL=<that server>.
 */
import { expect, test } from './support/fixtures';

const BRAND = process.env.E2E_BRAND_NAME ?? 'Stubbed';

test('the brand name comes from config: header, <title>, og:site_name, review count label', async ({
  page,
}) => {
  await page.goto('/');
  const home = page.getByRole('link', { name: `${BRAND} home` });
  await expect(home).toBeVisible();
  await expect(home).toHaveText(new RegExp(BRAND));
  await expect(page).toHaveTitle(new RegExp(`^${BRAND} — `));
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', BRAND);
  await page.goto('/title/movie/693134');
  await expect(page).toHaveTitle(new RegExp(` · ${BRAND}$`));
  await expect(
    page.getByRole('button', { name: new RegExp(`^On ${BRAND} · \\d+$`) }),
  ).toBeVisible();
  if (BRAND !== 'Stubbed') {
    // No user-visible "Stubbed" left in the visible text of these pages.
    for (const url of ['/', '/about', '/title/movie/693134']) {
      await page.goto(url);
      expect(await page.locator('body').innerText(), url).not.toContain('Stubbed');
    }
  }
});
