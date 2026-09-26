/**
 * Epic C — Stub it (C1), stub with details (C2), rewatches (C3), manage stubs in /me/stubs (C4, C5),
 * watchlist (C6). Every test uses a fresh account.
 */
import type { Page } from '@playwright/test';
import {
  TODAY,
  detailStubButton,
  detailStubLine,
  expect,
  gotoTitle,
  isMobile,
  perProject,
  shot,
  signUpApi,
  stubApi,
  test,
  toast,
  waitForSession,
} from './support/fixtures';

const walletBadge = (page: Page) => page.locator('[data-wallet-badge]:visible');

test.describe('C1 / C3 Stub it, rewatches, undo, same-day confirm', () => {
  test('one tap stubs (optimistic count, stamp, toast), Undo removes it, rewatches count', async ({
    page,
  }, info) => {
    const key = perProject(info, 'movie:157336', 'movie:27205'); // Interstellar / Inception
    await signUpApi(page, 'st');
    await gotoTitle(page, key);
    await waitForSession(page, true);
    const line = detailStubLine(page);
    await expect(line).toHaveAttribute('data-count', '0');
    await expect(line).toContainText('Not stubbed yet');
    await expect(walletBadge(page)).toHaveText('0');

    await detailStubButton(page).click();
    await expect(line).toHaveAttribute('data-count', '1');
    await expect(line).toContainText('1× STUBBED');
    await expect(line).toContainText('Last stub Sep 26, 2026');
    await expect(detailStubButton(page)).toHaveText('Stub again');
    await expect(page.getByTestId(`ticket-${key}`).getByText('1× stubbed')).toBeVisible(); // stamp
    const t = toast(page).filter({ hasText: '1× stubbed' });
    await expect(t).toBeVisible();
    await expect(walletBadge(page)).toHaveText('1');
    await shot(page, info, 'stub-toast');

    await t.getByRole('button', { name: 'Undo' }).click();
    await expect(toast(page).filter({ hasText: 'Stub removed' })).toBeVisible();
    await expect(line).toHaveAttribute('data-count', '0');
    await expect(detailStubButton(page)).toHaveText('Stub it');
    await expect(walletBadge(page)).toHaveText('0');

    // Rewatch: first stub today, then a second one today asks first (C3-AC3).
    await detailStubButton(page).click();
    await expect(line).toHaveAttribute('data-count', '1');
    await detailStubButton(page).click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg.getByRole('heading', { name: 'Stub again today?' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Stub again' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toBeHidden();
    await expect(line).toHaveAttribute('data-count', '1');
    await detailStubButton(page).click();
    await dlg.getByRole('button', { name: 'Stub again' }).click();
    await expect(line).toHaveAttribute('data-count', '2');
    await expect(line).toContainText('2× STUBBED');
    await expect(page.getByTestId(`ticket-${key}`).getByText('2× stubbed')).toBeVisible();

    // Persisted: reload keeps the count (E2).
    await page.reload();
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '2');
    await expect(walletBadge(page)).toHaveText('2');
  });

  test('C2 stub with details: date limits, where, note counter; rewatches get their own diary rows', async ({
    page,
  }, info) => {
    const key = perProject(info, 'tv:1396', 'tv:1399'); // Breaking Bad (2008) / Game of Thrones (2011)
    const year = key === 'tv:1396' ? 2008 : 2011;
    await signUpApi(page, 'sd');
    await gotoTitle(page, key);
    await waitForSession(page, true);

    await page.getByTestId('stub-details').click();
    const sheet = page.getByTestId('stub-sheet');
    await expect(sheet.getByRole('heading', { name: 'Stub with details' })).toBeVisible();
    const date = sheet.getByLabel('Watched on');
    await expect(date).toHaveValue(TODAY);
    await expect(date).toHaveAttribute('max', TODAY);
    await expect(date).toHaveAttribute('min', `${year - 1}-01-01`);
    await date.fill('2026-12-01');
    await sheet.getByRole('button', { name: 'Stub it' }).click();
    await expect(sheet.getByRole('alert')).toHaveText("Pick a date that isn't in the future.");
    await date.fill(`${year - 2}-06-01`);
    await sheet.getByRole('button', { name: 'Stub it' }).click();
    await expect(sheet.getByRole('alert')).toHaveText(`Pick a date from ${year - 1} or later.`);

    await date.fill('2025-12-01');
    const where = sheet.getByRole('group', { name: 'Where' });
    await expect(where.getByRole('button')).toHaveText(['Cinema', 'Streaming', 'TV', 'Other']);
    await where.getByRole('button', { name: 'Streaming' }).click();
    await expect(where.getByRole('button', { name: 'Streaming' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const note = sheet.getByLabel(/Note/);
    await expect(note).toHaveAttribute('maxlength', '280');
    await note.fill('Binge with the flatmates');
    await expect(sheet.getByText('24 / 280')).toBeVisible();
    await shot(page, info, 'stub-sheet');
    await sheet.getByRole('button', { name: 'Stub it' }).click();
    await expect(sheet).toBeHidden();
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '1');

    // Two more watches on other dates (no same-day confirm), then today.
    for (const d of ['2026-01-15', '2026-03-03']) {
      await page.getByTestId('stub-details').click();
      await sheet.getByLabel('Watched on').fill(d);
      await sheet.getByRole('button', { name: 'Stub it' }).click();
      await expect(sheet).toBeHidden();
    }
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '3');
    await expect(detailStubLine(page)).toContainText('Last stub Mar 3, 2026');

    // C3-AC2: each stub is its own diary row with its own date; count = rows.
    await page.goto('/me/stubs');
    const rows = page.getByTestId('diary-row');
    await expect(rows).toHaveCount(3);
    await expect(page.getByText('3 STUBS')).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute('aria-label', /watched Mar 3, 2026, stub number 3$/);
    await expect(rows.nth(1)).toHaveAttribute('aria-label', /watched Jan 15, 2026, stub number 2$/);
    await expect(rows.nth(2)).toHaveAttribute(
      'aria-label',
      /watched Dec 1, 2025, stub number 1, streaming$/,
    );
    await expect(rows.nth(2)).toContainText('Binge with the flatmates');
    await expect(rows.nth(0)).toContainText('Rewatch');
    // Grouped by month, newest first.
    await expect(page.locator('main section h3')).toHaveText([
      /March 2026\s*1 stub/,
      /January 2026\s*1 stub/,
      /December 2025\s*1 stub/,
    ]);
  });

  test('API: future dates are rejected (today + 1 allowed for users ahead of UTC); same-day duplicates allowed', async ({
    page,
  }) => {
    await signUpApi(page, 'sv');
    const bad = await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 603, watchedOn: '2026-09-28' },
    });
    expect(bad.status()).toBe(400);
    expect(
      ((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields.watchedOn,
    ).toBeTruthy();
    const early = await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 603, watchedOn: '1997-12-31' },
    });
    expect(early.status()).toBe(400);
    expect((await stubApi(page, 'movie:603', { watchedOn: '2026-09-27' })).state.stubCount).toBe(1);
    await stubApi(page, 'movie:603');
    const third = await stubApi(page, 'movie:603');
    expect(third.state.stubCount).toBe(3);
    const unknown = await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 1 },
    });
    expect(unknown.status()).toBe(404);
  });

  test('card quick action on the grid: tap stubs, the badge shows N×; long-press opens the details sheet', async ({
    page,
  }, info) => {
    await signUpApi(page, 'qc');
    await page.goto('/browse?sort=rating_desc');
    await waitForSession(page, true);
    const key = perProject(info, 'movie:278', 'movie:238');
    const ticket = page.getByTestId(`ticket-${key}`);
    const btn = ticket.getByTestId('stub-button');
    await expect(btn).toHaveAccessibleName(/^Stub it: /);
    if (isMobile(info)) await btn.tap();
    else await btn.click();
    await expect(btn).toHaveAttribute('data-count', '1');
    await expect(btn.getByTestId('stub-count')).toHaveText('1×');
    await expect(btn).toHaveAccessibleName(/^Stub again: .+ \(1× stubbed\)$/);
    await expect(ticket.getByText('1× stubbed')).toBeVisible();
    await shot(page, info, 'grid-stubbed');

    // Long press (550 ms) opens "Stub with details" instead of stubbing.
    const box = (await btn.boundingBox())!;
    await btn.dispatchEvent('pointerdown', {
      button: 0,
      pointerType: isMobile(info) ? 'touch' : 'mouse',
      clientX: box.x + 5,
      clientY: box.y + 5,
    });
    await page.waitForTimeout(800);
    await btn.dispatchEvent('pointerup', { button: 0 });
    await btn.dispatchEvent('click');
    const sheet = page.getByTestId('stub-sheet');
    await expect(sheet.getByRole('heading', { name: 'Stub with details' })).toBeVisible();
    await expect(btn).toHaveAttribute('data-count', '1');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('C4 / C5 My stubs', () => {
  test('edit and delete stubs (with confirmation), counts update; type filter; empty state', async ({
    page,
  }, info) => {
    await signUpApi(page, 'ms');
    await page.goto('/me/stubs');
    await expect(page.getByText('No stubs yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse titles' })).toHaveAttribute(
      'href',
      '/browse',
    );

    await stubApi(page, 'movie:329865', { watchedOn: '2026-08-01', watchedWhere: 'cinema' }); // Arrival
    await stubApi(page, 'movie:329865', { watchedOn: '2026-09-01' });
    await stubApi(page, 'tv:2316', { watchedOn: '2026-07-04' }); // The Office
    await page.goto('/me/stubs');
    await expect(page.getByText('3 STUBS')).toBeVisible();
    await expect(page.getByTestId('diary-row')).toHaveCount(3);

    // Type filter + count for the filter (contract v1.2).
    await page.getByTestId('type-filter').getByRole('link', { name: 'Shows' }).click();
    await expect(page).toHaveURL(/\/me\/stubs\?type=tv$/);
    await expect(page.getByTestId('diary-row')).toHaveCount(1);
    await expect(page.getByText('1 STUB', { exact: true })).toBeVisible();
    await page.getByTestId('type-filter').getByRole('link', { name: 'Movies' }).click();
    await expect(page.getByTestId('diary-row')).toHaveCount(2);
    await expect(page.getByText('2 STUBS')).toBeVisible();
    await page.getByTestId('type-filter').getByRole('link', { name: 'All' }).click();
    await expect(page.getByTestId('diary-row')).toHaveCount(3);
    await shot(page, info, 'my-stubs');

    // Edit the Aug 1 Arrival stub: date, where, note.
    await page.getByRole('button', { name: 'Options for Arrival, 2026-08-01' }).click();
    await page
      .getByRole('group', { name: 'Stub options' })
      .getByRole('button', { name: 'Edit' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Edit stub' });
    await expect(sheet.getByLabel('Watched on')).toHaveValue('2026-08-01');
    await expect(sheet.getByRole('button', { name: 'Cinema' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sheet.getByLabel('Watched on').fill('2026-02-02');
    await sheet.getByRole('button', { name: 'TV' }).click();
    await sheet.getByLabel(/Note/).fill('Rainy Sunday');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page).filter({ hasText: 'Stub updated' })).toBeVisible();
    const edited = page.getByTestId('diary-row').filter({ hasText: 'Rainy Sunday' });
    await expect(edited).toHaveAttribute(
      'aria-label',
      /Arrival, movie, watched Feb 2, 2026, stub number 1, tv$/,
    );

    // Delete the Office stub: confirm focuses Cancel, and says what the count becomes.
    await page.getByRole('button', { name: 'Options for The Office, 2026-07-04' }).click();
    await page
      .getByRole('group', { name: 'Stub options' })
      .getByRole('button', { name: 'Delete' })
      .click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg.getByRole('heading', { name: 'Delete this stub?' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('diary-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Options for The Office, 2026-07-04' }).click();
    await page
      .getByRole('group', { name: 'Stub options' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await dlg.getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page).filter({ hasText: 'Stub deleted' })).toBeVisible();
    await expect(page.getByTestId('diary-row')).toHaveCount(2);
    await expect(page.getByText('2 STUBS')).toBeVisible();
    await expect(walletBadge(page)).toHaveText('2');
    await gotoTitle(page, 'tv:2316');
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '0');
  });
});

test.describe('C6 watchlist', () => {
  test('add / remove; stubbing a watchlisted title offers to remove it; list is private', async ({
    page,
    browser,
  }, info) => {
    const acc = await signUpApi(page, 'wl');
    const key = perProject(info, 'movie:313369', 'movie:76341'); // La La Land / Mad Max
    await gotoTitle(page, key);
    await waitForSession(page, true);
    const wl = page.getByTestId('watchlist-button');
    await wl.click();
    await expect(wl).toHaveAttribute('aria-pressed', 'true');
    await expect(toast(page).filter({ hasText: /Added .+ to your watchlist/ })).toBeVisible();
    await wl.click();
    await expect(wl).toHaveAttribute('aria-pressed', 'false');
    await expect(toast(page).filter({ hasText: 'Removed from watchlist' })).toBeVisible();
    await wl.click();
    await expect(wl).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`/u/${acc.handle}?tab=watchlist`);
    await expect(
      page.getByRole('list', { name: 'Watchlist' }).getByTestId(`ticket-${key}`),
    ).toBeVisible();
    await gotoTitle(page, key);
    await detailStubButton(page).click();
    const offer = toast(page).filter({ hasText: /Remove it from your watchlist\?/ });
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('watchlist-button')).toHaveAttribute('aria-pressed', 'false');
    const st = await (await page.request.get(`/api/me/title-states?keys=${key}`)).json();
    expect(st.states[key]).toMatchObject({ stubCount: 1, watchlisted: false });

    // A visitor cannot see someone else's watchlist.
    const other = await browser.newPage();
    await other.goto(`/u/${acc.handle}?tab=watchlist`);
    await expect(other.getByText('This list is private')).toBeVisible();
    await expect(
      other
        .getByRole('navigation', { name: 'Profile sections' })
        .getByRole('link', { name: 'Watchlist' }),
    ).toHaveCount(0);
    expect((await other.request.get('/api/me/watchlist')).status()).toBe(401);
    await other.close();
  });
});
