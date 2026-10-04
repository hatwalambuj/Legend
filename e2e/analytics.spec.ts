/**
 * C-Q5 first-party analytics + client error reports (ADR-013 C-09/C-13, API_CONTRACT v1.6 §5.24/§5.25):
 * `share_generated` is beaconed to /api/events (same origin, allowlisted names only); Global Privacy
 * Control sends nothing; uncaught errors and rejections are reported to /api/log (204).
 * Every test also runs the fixture guard: no request leaves the app origin.
 */
import type { Page, Request } from '@playwright/test';
import { expect, gotoTitle, test } from './support/fixtures';

async function stubShare(page: Page, gpc: boolean) {
  await page.addInitScript((g) => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
    if (g)
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
  }, gpc);
}

function collect(page: Page, suffix: string) {
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === suffix) seen.push(r);
  });
  return seen;
}

test.describe('C-Q5 analytics and error reports', () => {
  test('a share sends one allowlisted share_generated event to /api/events', async ({ page }) => {
    await stubShare(page, false);
    const events = collect(page, '/api/events');
    await gotoTitle(page, 'movie:693134');
    await page.getByRole('button', { name: 'Share Dune: Part Two' }).click();
    // The queue flushes after ≤ 5 s or on pagehide.
    await expect.poll(() => events.length, { timeout: 9_000 }).toBeGreaterThan(0);
    const bodies = events.map(
      (r) => JSON.parse(r.postData() ?? '{}') as { events: { name: string; dim: string }[] },
    );
    const all = bodies.flatMap((b) => b.events);
    expect(all.some((e) => e.name === 'share_generated')).toBe(true);
    for (const e of all)
      expect(['share_generated', 'worth_it_viewed', 'provider_clicked']).toContain(e.name);
    // Nothing personal in the payload.
    expect(JSON.stringify(bodies)).not.toMatch(/@|email|handle/i);
  });

  test('Global Privacy Control: no /api/events request at all; the server ignores Sec-GPC: 1', async ({
    page,
  }) => {
    await stubShare(page, true);
    const events = collect(page, '/api/events');
    await gotoTitle(page, 'movie:693134');
    await page.getByRole('button', { name: 'Share Dune: Part Two' }).click();
    await page.waitForTimeout(6_500);
    await page.goto('/about'); // pagehide flush point
    expect(events).toHaveLength(0);
    const r = await page.request.post('/api/events', {
      headers: { 'Sec-GPC': '1' },
      data: { events: [{ name: 'share_generated', dim: 'title:native' }] },
    });
    expect(r.status()).toBe(204);
  });

  test('uncaught errors and rejections are reported to /api/log (kind, message, path; 204)', async ({
    page,
    allowConsole,
  }) => {
    allowConsole.push(/qa-e2e-(unhandled|rejection)/);
    const logs = collect(page, '/api/log');
    const done: number[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname === '/api/log') done.push(r.status());
    });
    await page.goto('/about');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('qa-e2e-unhandled');
      });
      void Promise.reject(new Error('qa-e2e-rejection'));
    });
    await expect.poll(() => logs.length).toBeGreaterThanOrEqual(2);
    const sent = logs.map((r) => JSON.parse(r.postData() ?? '{}') as Record<string, string>);
    expect(sent.find((b) => b.kind === 'unhandled')?.message).toContain('qa-e2e-unhandled');
    expect(sent.find((b) => b.kind === 'rejection')?.message).toContain('qa-e2e-rejection');
    for (const b of sent) expect(b.path).toBe('/about');
    await expect.poll(() => done.length).toBeGreaterThanOrEqual(2);
    expect(done.every((s) => s === 204)).toBe(true);
    // Contract: a bad body is rejected.
    expect((await page.request.post('/api/log', { data: { kind: 'nope' } })).status()).toBe(400);
  });
});
