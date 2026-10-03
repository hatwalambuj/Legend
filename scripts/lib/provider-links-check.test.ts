import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_LINK_HOSTS } from '../../src/lib/provider-links';
import {
  checkAll,
  checkTarget,
  classifyError,
  classifyStatus,
  exitCodeFor,
  formatResults,
  linkTargets,
} from './provider-links-check';

describe('linkTargets', () => {
  const targets = linkTargets();
  it('covers every allowlisted host, deduplicated, all https, sample title filled in', () => {
    const hosts = new Set(targets.map((t) => new URL(t.url).host));
    expect(hosts).toEqual(new Set(PROVIDER_LINK_HOSTS));
    expect(new Set(targets.map((t) => t.url)).size).toBe(targets.length);
    for (const t of targets) {
      expect(t.url.startsWith('https://')).toBe(true);
      expect(t.url).not.toContain('{title}');
    }
    expect(targets.find((t) => t.url === 'https://www.netflix.com/')?.providerIds).toEqual([8, 1796]);
    expect(targets.some((t) => t.url.includes('Dune%3A%20Part%20Two'))).toBe(true);
    expect(targets.some((t) => t.label === '10 home (GB)')).toBe(true);
  });
});

describe('classification', () => {
  it('tolerates bot-blocks, fails 5xx and non-https, warns 404', () => {
    expect(classifyStatus(200, 'https://x/').verdict).toBe('ok');
    expect(classifyStatus(301, 'https://x/').verdict).toBe('ok');
    expect(classifyStatus(403, 'https://x/').verdict).toBe('blocked');
    expect(classifyStatus(429, 'https://x/').verdict).toBe('blocked');
    expect(classifyStatus(404, 'https://x/').verdict).toBe('warn');
    expect(classifyStatus(503, 'https://x/').verdict).toBe('fail');
    expect(classifyStatus(200, 'http://x/').verdict).toBe('fail');
  });
  it('fails DNS / TLS errors, warns timeouts', () => {
    expect(classifyError({ cause: { code: 'ENOTFOUND' } })).toEqual({
      verdict: 'fail',
      detail: 'DNS ENOTFOUND',
    });
    expect(classifyError({ cause: { code: 'CERT_HAS_EXPIRED' } }).verdict).toBe('fail');
    expect(classifyError({ name: 'TimeoutError' }).verdict).toBe('warn');
  });
});

describe('checkTarget / checkAll (mocked fetch)', () => {
  const t = { label: '8 home', url: 'https://www.netflix.com/', providerIds: [8] };
  it('reports the status and final URL verdict', async () => {
    const f = vi.fn(async () => {
      const r = new Response('', { status: 403 });
      return r;
    });
    expect((await checkTarget(t, f)).verdict).toBe('blocked');
    expect(f).toHaveBeenCalledWith(t.url, expect.objectContaining({ method: 'GET', redirect: 'follow' }));
  });
  it('exit 1 only when something fails', async () => {
    const targets = [t, { ...t, url: 'https://broken.example/', label: 'x home' }];
    const res = await checkAll(targets, async (url) => {
      if (url.includes('broken')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      return new Response('', { status: 429 });
    });
    expect(res.map((r) => r.verdict)).toEqual(['blocked', 'fail']);
    expect(exitCodeFor(res)).toBe(1);
    expect(exitCodeFor(res.slice(0, 1))).toBe(0);
    expect(formatResults(res)).toMatch(/1 bot-blocked \(tolerated\).*1 failing/);
  });
});
