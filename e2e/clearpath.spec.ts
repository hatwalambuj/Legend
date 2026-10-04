/**
 * ClearPath verification pass (QA): coverage the code review and architecture review flagged as
 * missing — delete account (GAP-06), wallet score labels, 375×812 title fold, footer Contact/Terms,
 * Report on others' reviews, demo pill copy — plus regression checks for code-review follow-ups
 * F3 (edit a stub dated today+1) and F4 ("On Stubbed · N" after deleting your review).
 */
import {
  DEMO_PASSWORD,
  TODAY,
  detailStubButton,
  expect,
  gotoTitle,
  isMobile,
  perProject,
  reviewApi,
  signInApi,
  signUpApi,
  stubApi,
  test,
  toast,
  waitForSession,
} from './support/fixtures';

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test.describe('GAP-06 delete account', () => {
  test('typed confirm gates the button; DELETE /api/me → 204; the account cannot sign in again', async ({
    page,
    allowConsole,
  }) => {
    allowConsole.push(/status of 401/);
    allowConsole.push(/status of 404/); // the deleted user's /u/{handle} is a real 404 (C-03)
    const acc = await signUpApi(page, 'del');
    await stubApi(page, 'movie:329865'); // Arrival — owned data that must go too
    await page.goto('/me/settings');
    await waitForSession(page, true);

    await page.getByTestId('delete-account').click();
    const input = page.getByTestId('delete-account-input');
    const confirm = page.getByTestId('delete-account-confirm');
    await expect(input).toBeFocused();
    await expect(confirm).toBeDisabled();
    await input.fill('delete'); // case matters
    await expect(confirm).toBeDisabled();
    await input.fill('DELET');
    await expect(confirm).toBeDisabled();
    // Esc cancels and returns focus to the trigger.
    await input.press('Escape');
    await expect(page.getByTestId('delete-account')).toBeFocused();

    await page.getByTestId('delete-account').click();
    await page.getByTestId('delete-account-input').fill('DELETE');
    await expect(confirm).toBeEnabled();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'DELETE'),
      confirm.click(),
    ]);
    expect(res.status()).toBe(204);
    await expect(
      toast(page).filter({ hasText: 'Your account and all its data are deleted.' }),
    ).toBeVisible();
    await waitForSession(page, false);

    // Session is gone server-side and the credentials no longer work.
    const me = await page.request.get('/api/me');
    expect(((await me.json()) as { session: unknown }).session).toBeNull();
    const signin = await page.request.post('/api/auth/signin', {
      data: { email: acc.email, password: acc.password },
      headers: { 'x-forwarded-for': '10.77.1.1' },
    });
    expect(signin.status()).toBe(401);
    // The public profile is gone: a real 404 status since ADR-013 C-03 (was a soft 404, BUG-03).
    const gone = await page.goto(`/u/${acc.handle}`);
    expect(gone?.status()).toBe(404);
    await expect(page.getByTestId('not-found')).toBeVisible();
  });

  test('API: missing/wrong confirm → 400, signed out → 401, seeded demo account → 403', async ({
    page,
  }) => {
    const out = await page.request.delete('/api/me', { data: { confirm: 'DELETE' } });
    expect(out.status()).toBe(401);

    await signUpApi(page, 'dlv');
    expect((await page.request.delete('/api/me', { data: {} })).status()).toBe(400);
    expect((await page.request.delete('/api/me', { data: { confirm: 'delete' } })).status()).toBe(
      400,
    );
    // Still signed in after the rejected attempts.
    const me = await page.request.get('/api/me');
    expect(((await me.json()) as { session: unknown }).session).not.toBeNull();

    await signInApi(page, 'maya@demo.stubbed.app', DEMO_PASSWORD);
    const seeded = await page.request.delete('/api/me', { data: { confirm: 'DELETE' } });
    expect(seeded.status()).toBe(403);
    expect(await seeded.text()).toContain("Demo accounts can't be deleted");
    // maya still exists and can sign in.
    await signInApi(page, 'maya@demo.stubbed.app', DEMO_PASSWORD);
  });
});

test.describe('GAP-02 wallet score labels', () => {
  test('wallet stubs show "TMDB x.x" + IMDb chip; the IMDb chip is hidden for Bluey', async ({
    page,
  }) => {
    const acc = await signUpApi(page, 'wal');
    await stubApi(page, 'tv:82728'); // Bluey — no IMDb id
    await stubApi(page, 'movie:693134'); // Dune: Part Two — TMDB 8.1, IMDb 8.5
    await page.goto(`/u/${acc.handle}`);
    const bluey = page.getByTestId('wallet-stub').filter({ hasText: 'Bluey' });
    await expect(bluey).toHaveCount(1);
    await expect(bluey.getByTestId('tmdb-rating')).toHaveText('TMDB 8.6');
    await expect(bluey.getByTestId('imdb-rating')).toHaveCount(0);
    await expect(bluey).not.toContainText(/N\/A|IMDb 0/);
    const dune = page.getByTestId('wallet-stub').filter({ hasText: 'Dune: Part Two' });
    await expect(dune.getByTestId('tmdb-rating')).toHaveText('TMDB 8.1');
    await expect(dune.getByTestId('imdb-rating')).toHaveText(/IMDb\s*8\.5/);
  });
});

test.describe('mobile title fold (375×812)', () => {
  for (const key of ['movie:693134', 'movie:157336']) {
    test(`title, TMDB + IMDb chips and Stub it are above the fold: ${key}`, async ({
      page,
    }, info) => {
      test.skip(!isMobile(info), '375×812 only');
      await gotoTitle(page, key);
      const chips = page.locator('main').getByRole('list', { name: 'Ratings' });
      for (const el of [
        page.getByRole('heading', { level: 1 }),
        chips.getByTestId('tmdb-rating'),
        chips.getByTestId('imdb-rating'),
        detailStubButton(page),
      ]) {
        await expect(el).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }
});

test.describe('footer, Report, demo pill', () => {
  test('footer has Terms and a Contact mailto with the visible address', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Footer' });
    await expect(nav.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/about#terms');
    const contact = nav.getByTestId('footer-contact');
    await expect(contact).toHaveAttribute('href', /^mailto:[^?]+@[^?]+\?subject=Stubbed$/);
    await expect(contact).toContainText(/Contact\s*\S+@\S+/);
    await nav.getByRole('link', { name: 'Terms' }).click();
    await expect(page).toHaveURL(/\/about#terms$/);
    await expect(page.locator('section#terms')).toBeVisible();
  });

  test('Report shows on others’ reviews only (signed out: all; as @maya: not on her own; not on TMDB)', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:693134'); // 5 seeded Stubbed reviews incl. @maya
    const cards = page.getByTestId('review-card');
    await expect(cards).toHaveCount(5);
    await expect(page.getByTestId('report-review')).toHaveCount(5);
    const first = page.getByTestId('report-review').first();
    await expect(first).toHaveAttribute('href', /^mailto:.+\?subject=/);
    await expect(first).toHaveAttribute('aria-label', /^Report review by \w+$/);

    await signInApi(page, 'maya@demo.stubbed.app', DEMO_PASSWORD);
    await page.reload();
    await waitForSession(page, true);
    await expect(cards).toHaveCount(5);
    await expect(cards.filter({ hasText: '@maya' }).getByTestId('report-review')).toHaveCount(0);
    await expect(page.getByTestId('report-review')).toHaveCount(4);

    await page.getByRole('button', { name: /^From TMDB · \d+$/ }).click();
    await expect(page.getByTestId('tmdb-review-card').first()).toBeVisible();
    await expect(page.getByTestId('report-review')).toHaveCount(0);
  });

  test('demo pill reads "Demo: data resets" and explains it', async ({ page }) => {
    await page.goto('/');
    const pill = page.getByTestId('demo-pill').first();
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('Demo: data resets');
    await expect(pill).toHaveAttribute('aria-label', /^Demo: data resets\. .*wiped/);
    await expect(pill).toHaveAttribute('role', 'note');
  });
});

test.describe('code-review follow-ups', () => {
  test('F3: a stub dated today+1 (API slack) can be re-saved from the diary without changing its date', async ({
    page,
  }) => {
    const tomorrow = addDays(TODAY, 1);
    await signUpApi(page, 'f3');
    await stubApi(page, 'movie:329865', { watchedOn: tomorrow }); // accepted by the API (UTC slack)
    await page.goto('/me/stubs');
    await page.getByRole('button', { name: `Options for Arrival, ${tomorrow}` }).click();
    await page
      .getByRole('group', { name: 'Stub options' })
      .getByRole('button', { name: 'Edit' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Edit stub' });
    await expect(sheet.getByLabel('Watched on')).toHaveValue(tomorrow);
    await sheet.getByLabel(/Note/).fill('Late show');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByText("Pick a date that isn't in the future.")).toHaveCount(0);
    await expect(toast(page).filter({ hasText: 'Stub updated' })).toBeVisible();
    // A genuinely future date (today+2) is still refused client-side.
    await page.getByRole('button', { name: `Options for Arrival, ${tomorrow}` }).click();
    await page
      .getByRole('group', { name: 'Stub options' })
      .getByRole('button', { name: 'Edit' })
      .click();
    await sheet.getByLabel('Watched on').fill(addDays(TODAY, 2));
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByText("Pick a date that isn't in the future.")).toBeVisible();
  });

  test('F4: "On Stubbed · N" goes down by one after you delete your review', async ({
    page,
  }, info) => {
    const key = perProject(info, 'movie:872585', 'movie:545611'); // Oppenheimer / EEAAO
    await signUpApi(page, 'f4');
    await reviewApi(page, key, { rating10: 8, body: 'Counting check.' });
    await gotoTitle(page, key);
    await waitForSession(page, true);
    const tab = page.getByRole('button', { name: /^On Stubbed · \d+$/ });
    const before = Number((await tab.innerText()).match(/\d+$/)![0]);
    expect(before).toBeGreaterThan(0);
    await page
      .getByTestId('review-card')
      .filter({ hasText: 'Counting check.' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page).filter({ hasText: 'Review deleted' })).toBeVisible();
    await expect(page.getByRole('button', { name: `On Stubbed · ${before - 1}` })).toBeVisible();
  });
});
