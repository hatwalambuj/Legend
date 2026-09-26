/** Epic B — sign up (B1), sign in/out + magic link + resume-after-auth (B2), open-redirect guard. */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  DEMO_PASSWORD,
  detailStubButton,
  detailStubLine,
  expect,
  gotoTitle,
  isMobile,
  perProject,
  shot,
  test,
  toast,
  uniqueHandle,
  waitForSession,
} from './support/fixtures';

/** Account created from a separate API context, so the page itself stays signed out. */
async function makeAccount(request: APIRequestContext) {
  const handle = uniqueHandle('au');
  const acc = { email: `${handle}@e2e.test`, password: 'correct-horse-9', handle };
  const res = await request.post('/api/auth/signup', {
    data: acc,
    headers: {
      'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  });
  expect(res.status()).toBe(201);
  return acc;
}

async function fillSignIn(page: Page, email: string, password: string) {
  const form = page.getByTestId('auth-form');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('B1 sign up', () => {
  test('inline validation, handle availability, duplicate email/handle', async ({
    page,
    allowConsole,
  }, info) => {
    allowConsole.push(/status of 409/);
    await page.goto('/signup');
    const form = page.getByTestId('auth-form');
    await expect(form.getByRole('heading', { level: 1 })).toHaveText('Get your first stub');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.getByText('Enter a valid email')).toBeVisible();
    await expect(form.locator('.field-error').filter({ hasText: '8+ characters' })).toBeVisible();
    await expect(form.getByText('3–20 characters: a–z, 0–9 and _')).toBeVisible();
    await expect(form.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');

    await form.getByLabel('Password', { exact: true }).fill('short');
    await expect(form.locator('.field-error').filter({ hasText: '8+ characters' })).toBeVisible();
    await form.getByLabel('Handle').fill('Bad Handle!');
    await expect(form.getByText('3–20 characters: a–z, 0–9 and _')).toBeVisible();
    await form.getByLabel('Handle').fill('maya');
    await expect(form.getByText('That handle is taken.')).toBeVisible();
    await shot(page, info, 'signup-validation');

    // Duplicate email (seed account).
    await form.getByLabel('Email').fill('maya@demo.stubbed.app');
    await form.getByLabel('Password', { exact: true }).fill('long-enough-1');
    await form.getByLabel('Handle').fill(uniqueHandle('dup'));
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(
      form.getByText('An account with that email already exists. Sign in instead?'),
    ).toBeVisible();
    // Duplicate handle.
    await form.getByLabel('Email').fill(`${uniqueHandle('dup')}@e2e.test`);
    await form.getByLabel('Handle').fill('dev');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(form.locator('.field-error').filter({ hasText: /@dev is taken/ })).toBeVisible();
  });

  test('sign up from the auth sheet keeps you on the page you came from, signed in', async ({
    page,
  }) => {
    await gotoTitle(page, 'movie:603');
    await waitForSession(page, false);
    await page.getByRole('link', { name: 'Sign in' }).first().click();
    const sheet = page.getByTestId('auth-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Create an account' }).click();
    const handle = uniqueHandle('su');
    await sheet.getByLabel('Email').fill(`${handle}@e2e.test`);
    await sheet.getByLabel('Password', { exact: true }).fill('correct-horse-9');
    await sheet.getByLabel('Handle').fill(handle);
    await expect(sheet.getByText(`@${handle} is free`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Create account' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/title\/movie\/603-the-matrix$/);
    await expect(toast(page).filter({ hasText: `Signed in as @${handle}` })).toBeVisible();
    await waitForSession(page, true);
    // The session persists across reloads (B2-AC2).
    await page.reload();
    await waitForSession(page, true);
  });

  test('/signup?next= returns to the page you came from', async ({ page }) => {
    await page.goto('/signup?next=%2Fbrowse%3Ftype%3Dtv');
    const handle = uniqueHandle('nx');
    const form = page.getByTestId('auth-form');
    await form.getByLabel('Email').fill(`${handle}@e2e.test`);
    await form.getByLabel('Password', { exact: true }).fill('correct-horse-9');
    await form.getByLabel('Handle').fill(handle);
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/browse\?type=tv$/);
    await waitForSession(page, true);
  });
});

test.describe('B2 sign in / out', () => {
  test('wrong credentials show one generic error (existing or unknown email)', async ({
    page,
    allowConsole,
  }, info) => {
    allowConsole.push(/status of 401/);
    await page.goto('/signin');
    const form = page.getByTestId('auth-form');
    await fillSignIn(page, 'maya@demo.stubbed.app', 'not-the-password');
    const alert = form.getByRole('alert');
    await expect(alert).toHaveText("That email and password don't match.");
    await fillSignIn(page, 'nobody-here@e2e.test', 'not-the-password');
    await expect(alert).toHaveText("That email and password don't match.");
    await shot(page, info, 'signin-error');
  });

  test('demo account shortcut, session persists, sign out clears it', async ({ page }) => {
    await page.goto('/signin');
    const form = page.getByTestId('auth-form');
    await expect(
      form.getByText('Demo mode — accounts are stored on this server only.'),
    ).toBeVisible();
    await form.getByRole('button', { name: 'Use @priya' }).click();
    await expect(form.getByLabel('Email')).toHaveValue('priya@demo.stubbed.app');
    await expect(form.getByLabel('Password', { exact: true })).toHaveValue(DEMO_PASSWORD);
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await waitForSession(page, true);
    await page.reload();
    await waitForSession(page, true);

    await page.goto('/me/settings');
    await page.getByTestId('sign-out').click();
    await expect(toast(page).filter({ hasText: 'Signed out' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await waitForSession(page, false);
    await page.reload();
    await waitForSession(page, false);
    const me = (await (await page.request.get('/api/me')).json()) as { session: unknown };
    expect(me.session).toBeNull();
    await page.goto('/me/stubs');
    await expect(page).toHaveURL(/\/signin\?next=(%2F|\/)me(%2F|\/)stubs$/);
  });

  test('magic link (demo dev link) signs you in and lands on next', async ({ page, request }) => {
    const acc = await makeAccount(request);
    await page.goto('/signin?next=/me/stubs');
    const form = page.getByTestId('auth-form');
    await form.getByLabel('Email').fill(acc.email);
    await form.getByRole('button', { name: 'Email me a magic link' }).click();
    await expect(form.getByRole('status')).toContainText('Check your inbox for a sign-in link.');
    await form.getByRole('link', { name: 'open the magic link' }).click();
    await expect(page).toHaveURL(/\/me\/stubs$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My stubs' })).toBeVisible();
    await expect(page.getByText(`@${acc.handle} · diary`)).toBeVisible();
  });

  test('a broken magic link explains itself; callback never redirects off-site', async ({
    page,
    request,
  }) => {
    await page.goto('/auth/callback?demo_token=forged&next=/me/stubs');
    await expect(page).toHaveURL(/\/signin\?error=callback/);
    await expect(page.getByRole('alert').first()).toContainText("That sign-in link didn't work");

    const acc = await makeAccount(request);
    const payloads = [
      '//evil.com',
      '/\t/evil.com',
      '/\\evil.com',
      'https://evil.com',
      '/%09/evil.com',
      '/\n/evil.com',
    ];
    for (const next of payloads) {
      const res = await request.post('/api/auth/magic-link', {
        data: { email: acc.email },
        headers: { 'x-forwarded-for': `10.8.${Math.floor(Math.random() * 250)}.1` },
      });
      const { devLink } = (await res.json()) as { devLink: string };
      const u = new URL(devLink);
      u.searchParams.set('next', next);
      const cb = await request.get(`${u.pathname}${u.search}`, { maxRedirects: 0 });
      expect(cb.status(), next).toBe(302);
      const loc = cb.headers()['location']!;
      expect(loc, next).toMatch(/^\/(?![/\\])/);
      // Resolved the way a browser does, the target is always our own origin.
      const base = 'http://127.0.0.1:3100';
      expect(new URL(loc, base).origin, next).toBe(base);
    }
  });

  test('B2-AC3: Stub it while signed out → sign up in the sheet → the stub is created', async ({
    page,
  }) => {
    const key = perProject(test.info(), 'movie:13', 'movie:769');
    await gotoTitle(page, key);
    await waitForSession(page, false);
    await detailStubButton(page).click();
    const sheet = page.getByTestId('auth-sheet');
    await expect(sheet.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Create an account' }).click();
    const handle = uniqueHandle('rs');
    await sheet.getByLabel('Email').fill(`${handle}@e2e.test`);
    await sheet.getByLabel('Password', { exact: true }).fill('correct-horse-9');
    await sheet.getByLabel('Handle').fill(handle);
    await sheet.getByRole('button', { name: 'Create account' }).click();
    await expect(sheet).toBeHidden();
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '1');
    await expect(detailStubLine(page)).toContainText('1× STUBBED');
    await expect(toast(page).filter({ hasText: '1× stubbed' })).toBeVisible();
    const states = await (await page.request.get(`/api/me/title-states?keys=${key}`)).json();
    expect(states.states[key].stubCount).toBe(1);
  });

  test('B2-AC3: Watchlist and Review while signed out resume after sign in', async ({
    page,
    request,
  }) => {
    const acc = await makeAccount(request);
    await gotoTitle(page, 'movie:329865');
    await waitForSession(page, false);
    await page.getByTestId('watchlist-button').click();
    await fillSignIn(page, acc.email, acc.password);
    await expect(page.getByTestId('watchlist-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('watchlist-button')).toHaveText(/On watchlist/);

    // Review: signing out, then "Sign in to review" → the composer is focused after sign in.
    await page.request.post('/api/auth/signout', { data: {} });
    await page.reload();
    await waitForSession(page, false);
    await page.getByRole('button', { name: 'Sign in to review' }).click();
    await fillSignIn(page, acc.email, acc.password);
    const composer = page.getByTestId('review-composer');
    await expect(composer.getByRole('radiogroup', { name: /Rating/ })).toBeVisible();
    await expect(composer.getByRole('radio').first()).toBeFocused();
  });

  test('/signin?next=…&action=stub replays the stub after sign in', async ({
    page,
    request,
  }, info) => {
    const acc = await makeAccount(request);
    const key = perProject(info, 'movie:680', 'movie:550');
    const path =
      key === 'movie:680' ? '/title/movie/680-pulp-fiction' : '/title/movie/550-fight-club';
    await page.goto(`/signin?next=${encodeURIComponent(path)}&action=stub`);
    await fillSignIn(page, acc.email, acc.password);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(detailStubLine(page)).toHaveAttribute('data-count', '1');
    if (isMobile(info)) await shot(page, info, 'title-after-resume');
  });
});
