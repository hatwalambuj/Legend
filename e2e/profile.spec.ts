/** B3 profile (wallet / diary / reviews tabs + stats, owner edit), D4 export, review ↔ stub link. */
import {
  expect,
  expectNoHorizontalScroll,
  gotoTitle,
  shot,
  signUpApi,
  stubApi,
  test,
  toast,
  waitForSession,
} from './support/fixtures';

test.describe('B3 public profile', () => {
  test('/u/dev: header, stats, stub wallet (stacked rewatches), diary, reviews', async ({
    page,
  }, info) => {
    await page.goto('/u/dev');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dev');
    await expect(page.getByText('@dev · stubbing since 2023')).toBeVisible();
    await expect(
      page.getByText('Professional rewatcher. The Office is a lifestyle.'),
    ).toBeVisible();
    const stats = page.getByRole('list', { name: 'Stats' });
    await expect(stats.getByRole('listitem').nth(0)).toHaveText(/12\s*Total stubs/);
    await expect(stats.getByRole('listitem').nth(1)).toHaveText(/6\s*Stubs in 2026/);
    await expect(stats.getByRole('listitem').nth(2)).toHaveText(/6\s*Rewatches/);
    await expect(stats.getByRole('listitem').nth(3)).toHaveText(/×4\s*The Office\s*most stubbed/);

    const wallet = page.getByTestId('wallet-stub');
    await expect(wallet).toHaveCount(6); // one per title
    await expect(
      page.getByRole('link', { name: /^The Office, stubbed 4 times, last Sep 25, 2026$/ }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^Interstellar, stubbed 3 times/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, 'profile-wallet');

    const tabs = page.getByRole('navigation', { name: 'Profile sections' });
    await expect(tabs.getByRole('link', { name: 'Stub wallet' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await tabs.getByRole('link', { name: 'Diary' }).click();
    await expect(page).toHaveURL(/\/u\/dev\?tab=diary$/);
    await expect(page.getByTestId('diary-row')).toHaveCount(12);
    await expect(page.getByTestId('diary-row').first()).toHaveAttribute(
      'aria-label',
      /^The Office, show, watched Sep 25, 2026, stub number 4/,
    );
    // Hysteresis: Twilight stays in the diary although it is not listed (D4).
    await expect(page.getByTestId('diary-row').filter({ hasText: 'Twilight' })).toHaveCount(1);
    await shot(page, info, 'profile-diary');

    await tabs.getByRole('link', { name: 'Reviews · 4' }).click();
    await expect(page).toHaveURL(/\/u\/dev\?tab=reviews$/);
    await expect(page.getByTestId('review-card')).toHaveCount(4);
    await expect(page.getByTestId('review-card').first().getByRole('link').first()).toHaveAttribute(
      'href',
      /^\/title\//,
    );
    await shot(page, info, 'profile-reviews');
    // Visitors see no owner controls and no watchlist tab.
    await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: 'Watchlist' })).toHaveCount(0);
  });

  test('empty states: visitor view of leo, owner view of a new wallet', async ({ page }) => {
    await page.goto('/u/leo');
    await expect(page.getByText('No stubs yet')).toBeVisible();
    await expect(page.getByText("@leo hasn't stubbed anything yet.")).toBeVisible();
    const acc = await signUpApi(page, 'em');
    await page.goto(`/u/${acc.handle}`);
    await expect(page.getByText('Your wallet is empty')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse 6.5+ titles' })).toHaveAttribute(
      'href',
      '/browse',
    );
  });

  test('B3-AC2: the owner edits display name and bio; the handle cannot change', async ({
    page,
  }, info) => {
    const acc = await signUpApi(page, 'pf');
    await stubApi(page, 'movie:129', { watchedOn: '2026-01-02' });
    await stubApi(page, 'movie:129', { watchedOn: '2026-05-02' });
    await stubApi(page, 'tv:95396', { watchedOn: '2025-11-02' });
    await page.goto(`/u/${acc.handle}`);
    await waitForSession(page, true);
    const stats = page.getByRole('list', { name: 'Stats' });
    await expect(stats.getByRole('listitem').nth(0)).toHaveText(/3\s*Total stubs/);
    await expect(stats.getByRole('listitem').nth(1)).toHaveText(/2\s*Stubs in 2026/);
    await expect(stats.getByRole('listitem').nth(2)).toHaveText(/1\s*Rewatches/);
    await expect(page.getByTestId('wallet-stub')).toHaveCount(2);

    await page.getByRole('button', { name: 'Edit profile' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit profile' });
    await expect(sheet.getByText(`@${acc.handle} · handles can't be changed`)).toBeVisible();
    await expect(sheet.getByRole('textbox')).toHaveCount(2); // name + bio only
    await sheet.getByLabel('Display name').fill('QA Tester');
    await sheet.getByLabel('Bio').fill('Stubbing for science.');
    await expect(sheet.getByText('21 / 160')).toBeVisible();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page).filter({ hasText: 'Profile saved' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('QA Tester');
    await expect(page.getByText('Stubbing for science.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('QA Tester');
    await shot(page, info, 'profile-owner');
    // The API ignores a handle change.
    const res = await page.request.patch('/api/me/profile', {
      data: { displayName: 'QA Tester', handle: 'hacker' },
    });
    expect([200, 400]).toContain(res.status());
    const me = (await (await page.request.get('/api/me')).json()) as {
      session: { user: { handle: string } };
    };
    expect(me.session.user.handle).toBe(acc.handle);
  });

  test('R11: editing a review linked to stub #2 keeps "STUB #2"', async ({ page }) => {
    const acc = await signUpApi(page, 'lk');
    await stubApi(page, 'movie:496243', { watchedOn: '2026-01-01' });
    const second = await stubApi(page, 'movie:496243', { watchedOn: '2026-02-01' });
    const put = await page.request.put('/api/reviews', {
      data: {
        mediaType: 'movie',
        tmdbId: 496243,
        rating10: 8,
        body: 'Better the second time.',
        stubId: second.stub.id,
      },
    });
    expect(put.status()).toBe(201);
    await gotoTitle(page, 'movie:496243');
    const mine = page.getByTestId('review-card').filter({ hasText: `@${acc.handle}` });
    await expect(mine).toContainText('STUB #2');
    const c = page.getByTestId('review-composer');
    await c.getByLabel('Review text (optional)').fill('Even better the second time.');
    await c.getByRole('button', { name: 'Update review' }).click();
    await expect(mine).toContainText('EDITED');
    await expect(mine).toContainText('STUB #2');
    await page.reload();
    await expect(
      page.getByTestId('review-card').filter({ hasText: `@${acc.handle}` }),
    ).toContainText('STUB #2');
  });
});

test.describe('D4 export', () => {
  test('Letterboxd CSV + JSON download from Settings; 1 per 10 min per format', async ({
    page,
  }, info) => {
    const acc = await signUpApi(page, 'ex');
    await stubApi(page, 'movie:603', { watchedOn: '2026-01-10' }); // The Matrix ×2
    await stubApi(page, 'movie:603', { watchedOn: '2026-06-20' });
    await stubApi(page, 'tv:1396', { watchedOn: '2026-03-01' }); // TV → JSON only
    await page.request.put('/api/reviews', {
      data: { mediaType: 'movie', tmdbId: 603, rating10: 9, body: 'Red pill, "again", obviously' },
    });
    await page.request.put('/api/watchlist/movie/129', { data: {} });

    await page.goto('/me/stubs');
    await page.getByRole('link', { name: 'Export my stubs' }).click();
    await expect(page).toHaveURL(/\/me\/settings#export$/);
    await shot(page, info, 'settings-export');

    const [csvDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-letterboxd').click(),
    ]);
    expect(csvDl.suggestedFilename()).toBe('stubbed-letterboxd-2026-09-26.csv');
    const csv = await (await import('node:fs/promises')).readFile((await csvDl.path())!, 'utf8');
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review');
    expect(lines).toHaveLength(3); // two Matrix stubs, no TV
    expect(lines[1]).toBe('603,tt0133093,The Matrix,1999,,2026-01-10,false,');
    expect(lines[2]).toBe(
      '603,tt0133093,The Matrix,1999,9,2026-06-20,true,"Red pill, ""again"", obviously"',
    );

    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-json').click(),
    ]);
    expect(jsonDl.suggestedFilename()).toMatch(/\.json$/);
    const data = JSON.parse(
      await (await import('node:fs/promises')).readFile((await jsonDl.path())!, 'utf8'),
    );
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['exportedAt', 'profile', 'stubs', 'reviews', 'watchlist']),
    );
    expect(data.profile.handle).toBe(acc.handle);
    expect(data.stubs).toHaveLength(3);
    expect(data.reviews).toHaveLength(1);
    expect(data.watchlist).toHaveLength(1);

    const again = await page.request.get('/api/me/export?format=letterboxd');
    expect(again.status()).toBe(429);
    expect(Number(again.headers()['retry-after'])).toBeGreaterThan(0);
    // Signed out, export is refused.
    const anon = await page.context().browser()!.newContext();
    expect(
      (await anon.request.get(`${page.url().split('/me')[0]}/api/me/export?format=json`)).status(),
    ).toBe(401);
    await anon.close();
  });
});
