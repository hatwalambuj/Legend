/**
 * Epic D — write (D1), edit/delete (D2) reviews; one per user; spoilers; A8 community average and
 * "You rated"; E5 plain-text rendering.
 */
import type { APIRequestContext, Page, PlaywrightWorkerArgs } from '@playwright/test';
import {
  detailStubLine,
  expect,
  gotoTitle,
  perProject,
  shot,
  signUpApi,
  test,
  toast,
  uniqueHandle,
  waitForSession,
} from './support/fixtures';

async function titleReviews(request: APIRequestContext, key: string) {
  const [type, id] = key.split(':');
  const res = await request.get(`/api/titles/${type}/${id}/reviews?limit=50`);
  expect(res.ok()).toBe(true);
  return (
    (await res.json()) as { items: { id: string; rating10: number; author: { handle: string } }[] }
  ).items;
}

/** A background reviewer that never touches the page's cookies. */
async function backgroundReview(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  key: string,
  rating10: number,
) {
  const ctx = await playwright.request.newContext({ baseURL });
  const handle = uniqueHandle('bg');
  const res = await ctx.post('/api/auth/signup', {
    data: { email: `${handle}@e2e.test`, password: 'correct-horse-9', handle },
    headers: {
      'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  });
  expect(res.status()).toBe(201);
  const [mediaType, id] = key.split(':');
  expect(
    (await ctx.put('/api/reviews', { data: { mediaType, tmdbId: Number(id), rating10 } })).status(),
  ).toBe(201);
  await ctx.dispose();
}

function composer(page: Page) {
  return page.getByTestId('review-composer');
}

test.describe('D1 / D2 write, edit, delete', () => {
  test('rating required, half stars by keyboard, counter, spoiler switch; save → top of list, "You rated", add-a-stub offer', async ({
    page,
  }, info) => {
    const key = perProject(info, 'tv:66732', 'tv:1668'); // Stranger Things / Friends: no seed reviews
    const acc = await signUpApi(page, 'rv');
    await gotoTitle(page, key);
    await waitForSession(page, true);
    const c = composer(page);
    await expect(c.getByText('Write a review')).toBeVisible();
    await expect(c.getByRole('radio')).toHaveCount(10);
    await expect(c.getByText('Reviews are saved to Stubbed only.')).toBeVisible();
    await c.getByRole('button', { name: 'Post review' }).click();
    await expect(c.getByRole('alert')).toContainText(
      'Pick a star rating first — half stars are fine.',
    );
    await expect(c.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    await expect(c.getByRole('radio', { name: '0.5 stars', exact: true })).toBeFocused();

    // Keyboard: → steps half a star; End jumps to 5; ← back to 4.5.
    await page.keyboard.press('ArrowRight');
    await expect(c.getByRole('radio', { name: '0.5 stars', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('End');
    await expect(c.getByRole('radio', { name: '5 stars', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await expect(c.getByRole('radio', { name: '4.5 stars', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(c.getByText('4.5/5')).toBeVisible();

    const text = c.getByLabel('Review text (optional)');
    await expect(text).toHaveAttribute('maxlength', '5000');
    await expect(c.getByText('0 / 5,000')).toBeVisible();
    await text.fill('The pilot alone earns the stub. <b>not bold</b>');
    await expect(c.getByText('47 / 5,000')).toBeVisible();
    await c.getByRole('switch', { name: 'Contains spoilers' }).check();
    await shot(page, info, 'review-composer');
    await c.getByRole('button', { name: 'Post review' }).click();

    // D1-AC4: no stub yet → "Add a stub too?"
    const offer = toast(page).filter({ hasText: 'Add a stub too?' });
    await expect(offer).toBeVisible();
    const mine = page.getByTestId('review-card').first();
    await expect(mine).toContainText(`@${acc.handle}`);
    await expect(mine).toContainText('YOU');
    await expect(mine.getByRole('img', { name: '4.5 out of 5 stars' })).toBeVisible();
    await expect(mine.getByTestId('spoiler-toggle')).toBeVisible();
    await expect(page.getByTestId('my-rating')).toContainText('You rated ★★★★½'); // A8-AC3
    await offer.getByRole('button', { name: 'Add stub' }).click();
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '1');

    // E5: text is rendered as text, never HTML.
    await mine.getByTestId('spoiler-toggle').click();
    await expect(mine.getByText('<b>not bold</b>', { exact: false })).toBeVisible();
    await expect(mine.locator('p b')).toHaveCount(0);

    // Persisted and listed after reload; "On Stubbed" counts it.
    await page.reload();
    const n = (await titleReviews(page.request, key)).length; // ≥ 1 (re-runs add more)
    await expect(page.getByRole('button', { name: `On Stubbed · ${n}` })).toBeVisible();
    await expect(page.getByTestId('my-rating')).toContainText('You rated ★★★★½');
    await expect(composer(page).getByText('Your review')).toBeVisible();
  });

  test('one review per user: the form edits it (EDITED marker), delete removes it everywhere', async ({
    page,
    browser,
  }, info) => {
    const key = perProject(info, 'tv:70523', 'tv:19885'); // Dark / Sherlock
    const acc = await signUpApi(page, 'ed');
    await gotoTitle(page, key);
    await waitForSession(page, true);
    let c = composer(page);
    await c.getByRole('radio', { name: '3 stars', exact: true }).click();
    await c.getByLabel('Review text (optional)').fill('First take.');
    await c.getByRole('button', { name: 'Post review' }).click();
    await expect(toast(page).filter({ hasText: /Review saved|Review posted/ })).toBeVisible();
    await expect(page.getByTestId('review-card').first()).not.toContainText('EDITED');

    // The composer now edits the same review.
    c = composer(page);
    await expect(c.getByText('Your review')).toBeVisible();
    await expect(c.getByLabel('Review text (optional)')).toHaveValue('First take.');
    await expect(c.getByRole('radio', { name: '3 stars', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await c.getByRole('radio', { name: '4 stars', exact: true }).click();
    await c.getByLabel('Review text (optional)').fill('Second take: better.');
    await c.getByRole('button', { name: 'Update review' }).click();
    await expect(
      toast(page)
        .filter({ hasText: /Review updated|Add a stub too\?/ })
        .last(),
    ).toBeVisible();
    const card = page.getByTestId('review-card').filter({ hasText: `@${acc.handle}` });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('EDITED');
    await expect(card).toContainText('Second take: better.');
    await expect(page.getByTestId('my-rating')).toContainText('You rated ★★★★');

    // Server-side: still exactly one review by this user; a second PUT updates (200), not inserts.
    const [mediaType, id] = key.split(':');
    const again = await page.request.put('/api/reviews', {
      data: { mediaType, tmdbId: Number(id), rating10: 8, body: 'Second take: better.' },
    });
    expect(again.status()).toBe(200);
    const mineApi = (await titleReviews(page.request, key)).filter(
      (r) => r.author.handle === acc.handle,
    );
    expect(mineApi).toHaveLength(1);
    // Validation: rating out of range, body too long.
    expect(
      (
        await page.request.put('/api/reviews', {
          data: { mediaType, tmdbId: Number(id), rating10: 11 },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.put('/api/reviews', {
          data: { mediaType, tmdbId: Number(id), rating10: 5, body: 'x'.repeat(5001) },
        })
      ).status(),
    ).toBe(400);

    // Profile shows it; delete (confirm focuses Cancel) removes it from title + profile.
    await page.goto(`/u/${acc.handle}?tab=reviews`);
    await expect(page.getByTestId('review-card')).toHaveCount(1);
    await gotoTitle(page, key);
    await page
      .getByTestId('review-card')
      .filter({ hasText: `@${acc.handle}` })
      .getByRole('button', { name: 'Delete' })
      .click();
    const dlg = page.getByTestId('confirm-dialog');
    await expect(dlg.getByRole('heading', { name: 'Delete your review?' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page).filter({ hasText: 'Review deleted' })).toBeVisible();
    await expect(page.getByTestId('review-card').filter({ hasText: `@${acc.handle}` })).toHaveCount(
      0,
    );
    await expect(page.getByTestId('my-rating')).toHaveCount(0);
    await expect(composer(page).getByText('Write a review')).toBeVisible();
    await page.goto(`/u/${acc.handle}?tab=reviews`);
    await expect(page.getByTestId('review-card')).toHaveCount(0);
    await expect(page.getByText('No reviews yet')).toBeVisible();
    // A visitor doesn't see it either.
    const other = await browser.newPage();
    await other.goto(`/title/${key.replace(':', '/')}`);
    await expect(other.getByText(`@${acc.handle}`)).toHaveCount(0);
    await other.close();
  });

  test('a spoiler review is blurred for everyone else', async ({ page, browser }, info) => {
    const key = perProject(info, 'tv:97546', 'tv:65494'); // Ted Lasso / The Crown
    const acc = await signUpApi(page, 'sp');
    const [mediaType, id] = key.split(':');
    await page.request.put('/api/reviews', {
      data: {
        mediaType,
        tmdbId: Number(id),
        rating10: 7,
        body: 'The ending twist is X.',
        isSpoiler: true,
      },
    });
    const visitor = await browser.newPage();
    await visitor.goto(`/title/${mediaType}/${id}`);
    const card = visitor.getByTestId('review-card').filter({ hasText: `@${acc.handle}` });
    await expect(card.locator('[data-spoiler="hidden"]')).toHaveAttribute('aria-hidden', 'true');
    await expect(card.getByRole('button', { name: 'Show spoiler' })).toBeVisible();
    await visitor.close();
  });
});

test.describe('A8 community average', () => {
  test('average unlocks at 5 ratings and follows saves, edits and deletes', async ({
    page,
    playwright,
    baseURL,
  }, info) => {
    const key = perProject(info, 'movie:550', 'movie:680'); // Fight Club / Pulp Fiction
    const chip = page.getByTestId('stubbed-rating');
    let others = await titleReviews(page.request, key);
    while (others.length < 4) {
      await backgroundReview(playwright, baseURL!, key, 6);
      others = await titleReviews(page.request, key);
    }
    const mean = (xs: number[]) =>
      (Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10).toFixed(1);
    const expectChip = async (ratings: number[]) => {
      await page.reload();
      if (ratings.length === 0) await expect(chip).toHaveCount(0);
      else if (ratings.length < 5)
        await expect(chip).toHaveText(
          new RegExp(`^${ratings.length}\\s*STUBBED\\s*ratings? · average unlocks at 5$`),
        );
      else {
        await expect(chip).toContainText(mean(ratings));
        await expect(chip).toContainText(`${ratings.length} ratings`);
      }
    };
    const base = others.map((r) => r.rating10);
    await signUpApi(page, 'av');
    await gotoTitle(page, key);
    await expectChip(base);

    // Save (10), edit (to 1), delete — the chip follows each change.
    let c = composer(page);
    await c.getByRole('radio', { name: '5 stars', exact: true }).click();
    await c.getByRole('button', { name: 'Post review' }).click();
    await expect(toast(page).first()).toBeVisible();
    await expectChip([...base, 10]);
    await shot(page, info, 'stubbed-average');
    c = composer(page);
    await c.getByRole('radio', { name: '0.5 stars', exact: true }).click();
    await c.getByRole('button', { name: 'Update review' }).click();
    await expect(
      toast(page)
        .filter({ hasText: /Review updated|Add a stub too\?/ })
        .last(),
    ).toBeVisible();
    await expectChip([...base, 1]);
    await page
      .getByTestId('review-card')
      .filter({ hasText: 'YOU' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page).filter({ hasText: 'Review deleted' })).toBeVisible();
    await expectChip(base);
  });
});

test.describe('C-Q3 R10 review count (ADR-013 C-04)', () => {
  test('"On Stubbed · N" goes up by one right after a first review is posted (no reload); an edit keeps N', async ({
    page,
  }, info) => {
    const key = perProject(info, 'movie:155', 'movie:244786'); // The Dark Knight / Whiplash
    await signUpApi(page, 'r10');
    await gotoTitle(page, key);
    await waitForSession(page, true);
    const before = (await titleReviews(page.request, key)).length;
    await expect(page.getByRole('button', { name: `On Stubbed · ${before}` })).toBeVisible();
    const c = composer(page);
    await c.getByRole('radio', { name: '4 stars', exact: true }).click();
    await c.getByLabel('Review text (optional)').fill('R10 counting check.');
    await c.getByRole('button', { name: 'Post review' }).click();
    await expect(page.getByTestId('review-card').first()).toContainText('R10 counting check.');
    await expect(page.getByRole('button', { name: `On Stubbed · ${before + 1}` })).toBeVisible();
    // The server agrees after a reload.
    await page.reload();
    await expect(page.getByRole('button', { name: `On Stubbed · ${before + 1}` })).toBeVisible();
    expect((await titleReviews(page.request, key)).length).toBe(before + 1);
  });
});
