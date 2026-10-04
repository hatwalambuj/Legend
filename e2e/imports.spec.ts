/**
 * C-Q6 imports (ADR-013 C-11, API_CONTRACT v1.6 §5.26/§5.27): /me/import parses on the device, previews
 * (matched / already here / not in the catalogue / unreadable), commits, and the stubs appear in the
 * diary. Fixtures: e2e/fixtures/imports/. Re-upload → everything is "already here". TV Time is "beta".
 * A > 10 MB file is refused before anything is sent.
 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, shot, signUpApi, test, waitForSession } from './support/fixtures';

const FIX = path.resolve(__dirname, 'fixtures/imports');

async function openImport(page: Page) {
  await page.goto('/me/settings');
  await waitForSession(page, true);
  await page.getByTestId('import-link').click();
  await expect(page).toHaveURL(/\/me\/import$/);
  await expect(page.getByTestId('import-file')).toBeAttached();
}

async function upload(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page
    .getByTestId('import-file')
    .setInputFiles(typeof file === 'string' ? path.join(FIX, file) : file);
}

const count = (page: Page, k: 'matched' | 'duplicate' | 'notin' | 'invalid') =>
  page.getByTestId(`import-count-${k}`);

test.describe('C-Q6 import watch history', () => {
  test('Letterboxd diary CSV: preview → commit → stubs in the diary; re-upload → all already here', async ({
    page,
  }, info) => {
    const acc = await signUpApi(page, 'imp');
    await openImport(page);
    await expect(page.getByText('Your file stays on this device.')).toBeVisible();
    await upload(page, 'letterboxd-diary.csv');
    const preview = page.getByTestId('import-preview');
    await expect(preview).toBeVisible();
    await expect(count(page, 'matched')).toHaveText('3'); // 2 × Shawshank + Godfather
    await expect(count(page, 'duplicate')).toHaveText('0');
    await expect(count(page, 'notin')).toHaveText('1');
    await expect(preview.getByRole('list', { name: 'Some of the matched titles' })).toContainText(
      'The Shawshank Redemption (1994)',
    );
    await shot(page, info, 'import-preview');
    await page.getByTestId('import-commit').click();
    const summary = page.getByTestId('import-summary');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary.getByRole('status')).toContainText('3 stubs');

    // The stubs are real: diary rows with the imported dates.
    const diary = (await (await page.request.get('/api/me/stubs?limit=50')).json()) as {
      items: { titleKey: string; watchedOn: string }[];
    };
    expect(diary.items.map((d) => `${d.titleKey}@${d.watchedOn}`).sort()).toEqual(
      ['movie:238@2024-03-01', 'movie:278@2024-01-01', 'movie:278@2024-02-01'].sort(),
    );
    await summary.getByTestId('import-diary-link').click();
    await expect(page).toHaveURL(new RegExp(`/u/${acc.handle}\\?tab=diary$`));
    await expect(page.getByTestId('diary-row')).toHaveCount(3);

    // Re-upload: nothing new, everything is a duplicate.
    await openImport(page);
    await upload(page, 'letterboxd-diary.csv');
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(count(page, 'matched')).toHaveText('0');
    await expect(count(page, 'duplicate')).toHaveText('3');
    await expect(page.getByTestId('import-commit')).toBeDisabled();
  });

  test('IMDb ratings CSV: movie + show match, an episode row is not importable', async ({
    page,
  }) => {
    await signUpApi(page, 'imi');
    await openImport(page);
    await page.getByTestId('import-source-imdb').check();
    await upload(page, 'imdb-ratings.csv');
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(page.getByTestId('import-preview')).toContainText('3 rows');
    await expect(count(page, 'matched')).toHaveText('2');
    const skipped =
      Number(await count(page, 'notin').innerText()) +
      Number(await count(page, 'invalid').innerText());
    expect(skipped).toBe(1);
    await page.getByTestId('import-commit').click();
    await expect(page.getByTestId('import-summary')).toBeVisible({ timeout: 15_000 });
    const me = (await (await page.request.get('/api/me/stubs?limit=50')).json()) as {
      items: { titleKey: string }[];
    };
    expect(me.items.map((d) => d.titleKey).sort()).toEqual(['movie:278', 'tv:1396']);
  });

  test('our own Letterboxd export round-trips: re-importing it is all "already here"', async ({
    page,
  }) => {
    await signUpApi(page, 'imr');
    await page.request.post('/api/stubs', {
      data: { mediaType: 'movie', tmdbId: 278, watchedOn: '2025-05-05' },
    });
    const exp = await page.request.get('/api/me/export?format=letterboxd');
    expect(exp.ok()).toBe(true);
    await openImport(page);
    await upload(page, {
      name: 'stubbed-letterboxd.csv',
      mimeType: 'text/csv',
      buffer: await exp.body(),
    });
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await expect(count(page, 'duplicate')).toHaveText('1');
    await expect(count(page, 'matched')).toHaveText('0');
  });

  test('TV Time is labelled beta; a file over 10 MB is refused with a clear message, nothing sent', async ({
    page,
  }, info) => {
    await signUpApi(page, 'imx');
    await openImport(page);
    const tvtime = page.getByTestId('import-source-tvtime');
    await expect(tvtime.locator('xpath=..')).toContainText('TV Time');
    await expect(tvtime.locator('xpath=..')).toContainText('beta');
    await tvtime.check();
    await expect(page.getByText('We haven’t seen many TV Time exports yet')).toBeVisible();

    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/me/imports')) sent.push(r.url());
    });
    await page.getByTestId('import-source-letterboxd').check();
    const header = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n';
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 'a');
    Buffer.from(header).copy(big);
    await upload(page, { name: 'diary.csv', mimeType: 'text/csv', buffer: big });
    await expect(page.getByTestId('import-error')).toHaveText(
      'That file is over 10 MB. Export a smaller range and try again.',
    );
    await expect(page.getByTestId('import-preview')).toHaveCount(0);
    expect(sent).toEqual([]);
    await shot(page, info, 'import-too-large');
  });

  test('signed out: /me/import asks you to sign in', async ({ page }) => {
    await page.goto('/me/import');
    await expect(page).toHaveURL(/\/signin/);
  });
});
