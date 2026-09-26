import { expect, test } from '@playwright/test';

// Scaffold smoke test (Architect). QA owns e2e/** and may extend or replace this file.
test('boots in demo mode with zero env vars', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true, mode: { isDemo: true } });

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByTestId('demo-pill')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Only the good stuff');
  expect(errors).toEqual([]);
});
