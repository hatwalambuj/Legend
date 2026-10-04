/**
 * C-Q3 seasons (ADR-013 C-10, API_CONTRACT v1.6 §5.7/5.8): the "Season (optional)" picker in the stub
 * sheet for shows, the "S03" label on the diary row, the wallet stub and the share landing.
 */
import {
  expect,
  gotoTitle,
  perProject,
  shot,
  signUpApi,
  test,
  waitForSession,
} from './support/fixtures';

test.describe('C-Q3 season stubs', () => {
  test('a show stub with a season: picker in the sheet → "S03" on the diary row and share landing', async ({
    page,
  }, info) => {
    const key = perProject(info, 'tv:60059', 'tv:105248'); // Better Call Saul (6) / Hacks (4)
    await signUpApi(page, 'ssn');
    await gotoTitle(page, key);
    await waitForSession(page, true);
    await page.getByTestId('stub-details').click();
    const sheet = page.getByTestId('stub-sheet');
    const season = sheet.getByLabel(/^Season/);
    await expect(season).toHaveAttribute('data-testid', 'stub-season');
    await expect(season.locator('option').first()).toHaveText('Whole show');
    await expect(season.locator('option').nth(3)).toHaveText('S03');
    await season.selectOption('3');
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/stubs') && r.request().method() === 'POST'),
      sheet.getByRole('button', { name: 'Stub it' }).click(),
    ]);
    const body = (await res.json()) as { stub: { id: string; season: number | null } };
    expect(body.stub.season).toBe(3);

    await page.goto('/me/stubs');
    const row = page.getByTestId('diary-row').first();
    await expect(row.getByTestId('diary-season')).toHaveText('S03');
    await expect(row).toHaveAttribute('aria-label', /, season 3, watched /);
    await shot(page, info, 'diary-season');

    await page.goto(`/share/stub/${body.stub.id}`);
    await expect(page.locator('main')).toContainText('S03');
  });

  test('movies get no season picker; the API rejects a season on a movie', async ({ page }) => {
    await signUpApi(page, 'ssm');
    await gotoTitle(page, 'movie:419430'); // Get Out
    await waitForSession(page, true);
    await page.getByTestId('stub-details').click();
    await expect(page.getByTestId('stub-sheet')).toBeVisible();
    await expect(page.getByTestId('stub-season')).toHaveCount(0);
    const r = await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 419430, season: 2 },
    });
    expect(r.status()).toBe(400);
  });

  test('wallet stub: "S03" label + Share stub / Story image actions (API_CONTRACT v1.6.1)', async ({
    page,
  }, info) => {
    const key = perProject(info, 'tv:1429', 'tv:93405'); // Attack on Titan / Squid Game
    const [mediaType, id] = key.split(':');
    const acc = await signUpApi(page, 'wss');
    const r = await page.request.post('/api/stubs', {
      data: { mediaType, tmdbId: Number(id), season: 3 },
    });
    expect(r.ok()).toBe(true);
    await page.goto(`/u/${acc.handle}`);
    await waitForSession(page, true);
    const item = page.locator('li').filter({ has: page.getByTestId('wallet-stub') }).first();
    await expect(item).toBeVisible();
    const share = item.getByTestId('share-button');
    test.fixme(
      (await share.count()) === 0,
      'Wallet Share/season not in this build yet: backend is adding WalletItem.latestStubId/latestSeason (WalletStub.tsx, v1.6.1).',
    );
    await expect(item.getByTestId('wallet-season')).toHaveText('S03');
    await expect(item.getByTestId('wallet-stub')).toHaveAttribute('aria-label', /, season 3, stubbed 1 time/);
    await expect(share).toHaveAccessibleName(/^Share stub for /);
    await expect(item.getByTestId('share-story')).toBeVisible(); // owner-only
    await shot(page, info, 'wallet-season');
  });
});
