/**
 * Reachability check for every allowlisted "Where to watch" URL (C-14, FOUNDER_INPUTS F7; ADR-012 §6.3).
 * CLI: scripts/check-provider-links.ts. Pure classification + injected `fetch` (unit tests: no network).
 *
 * Verdicts
 * - ok:      2xx/3xx, ending on https.
 * - blocked: 401/403/405/429/451 or 999: streaming sites bot-block datacenter IPs. Tolerated.
 * - warn:    404/410 and other 4xx, or a timeout: a human should look (tap-through checklist).
 * - fail:    DNS failure, TLS/certificate error, connection refused, 5xx, or a redirect to plain http.
 */
import { PROVIDER_LINKS, type ProviderLink } from '../../src/lib/provider-links';

export type Verdict = 'ok' | 'blocked' | 'warn' | 'fail';

export interface LinkTarget {
  /** e.g. "8 home", "10 home (GB)", "3 search". */
  label: string;
  url: string;
  providerIds: number[];
}

export interface LinkResult extends LinkTarget {
  verdict: Verdict;
  status: number | null;
  /** Error code or final host when it differs; never the full URL of a redirect target. */
  detail: string;
}

export const SAMPLE_TITLE = 'Dune: Part Two';

/** Unique URLs to check: each home, search template (with the sample title) and regional storefront. */
export function linkTargets(
  links: Readonly<Record<number, ProviderLink>> = PROVIDER_LINKS,
  title = SAMPLE_TITLE,
): LinkTarget[] {
  const byUrl = new Map<string, LinkTarget>();
  const add = (id: number, label: string, url: string) => {
    const t = byUrl.get(url);
    if (t) {
      if (!t.providerIds.includes(id)) t.providerIds.push(id);
    } else byUrl.set(url, { label: `${id} ${label}`, url, providerIds: [id] });
  };
  for (const [key, p] of Object.entries(links)) {
    const id = Number(key);
    add(id, 'home', p.home);
    if (p.search) add(id, 'search', p.search.replace('{title}', encodeURIComponent(title)));
    for (const [region, e] of Object.entries(p.byRegion ?? {})) {
      if (!e) continue;
      add(id, `home (${region})`, e.home);
      if (e.search)
        add(id, `search (${region})`, e.search.replace('{title}', encodeURIComponent(title)));
    }
  }
  return [...byUrl.values()];
}

const BOT_BLOCK = new Set([401, 403, 405, 429, 451, 999]);
const DNS = /^(ENOTFOUND|EAI_AGAIN|EAI_NONAME|EAI_FAIL)$/;
const TLS = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i;

export function classifyStatus(
  status: number,
  finalUrl: string,
): { verdict: Verdict; detail: string } {
  let finalProto = 'https:';
  try {
    finalProto = new URL(finalUrl).protocol;
  } catch {
    /* keep https */
  }
  if (status >= 500) return { verdict: 'fail', detail: 'server error' };
  if (finalProto !== 'https:') return { verdict: 'fail', detail: 'redirected to non-https' };
  if (status >= 200 && status < 400) return { verdict: 'ok', detail: '' };
  if (BOT_BLOCK.has(status)) return { verdict: 'blocked', detail: 'bot-block (tolerated)' };
  return {
    verdict: 'warn',
    detail: status === 404 || status === 410 ? 'not found' : 'client error',
  };
}

export function classifyError(e: unknown): { verdict: Verdict; detail: string } {
  const err = e as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? err?.code ?? '';
  const name = err?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return { verdict: 'warn', detail: 'timeout' };
  if (DNS.test(code)) return { verdict: 'fail', detail: `DNS ${code}` };
  if (TLS.test(code) || TLS.test(err?.cause?.message ?? ''))
    return { verdict: 'fail', detail: `TLS ${code || 'error'}` };
  return { verdict: 'fail', detail: code || name || 'network error' };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 stubbed-link-check';

export async function checkTarget(
  t: LinkTarget,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 15_000,
): Promise<LinkResult> {
  try {
    const res = await fetchImpl(t.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // We only need the status: drop the body.
    await res.body?.cancel().catch(() => undefined);
    const c = classifyStatus(res.status, res.url || t.url);
    return { ...t, status: res.status, ...c };
  } catch (e) {
    return { ...t, status: null, ...classifyError(e) };
  }
}

export async function checkAll(
  targets: LinkTarget[],
  fetchImpl: FetchLike = fetch,
  concurrency = 4,
): Promise<LinkResult[]> {
  const out: LinkResult[] = new Array(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        out[i] = await checkTarget(targets[i]!, fetchImpl);
      }
    }),
  );
  return out;
}

export function formatResults(results: LinkResult[]): string {
  const lines = results.map(
    (r) =>
      `${r.verdict.toUpperCase().padEnd(7)} ${String(r.status ?? '---').padEnd(4)} ${r.label.padEnd(22)} ${r.url}${r.detail ? `  (${r.detail})` : ''}`,
  );
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  lines.push(
    '',
    `${results.length} URLs: ${count('ok')} ok, ${count('blocked')} bot-blocked (tolerated), ${count('warn')} to look at, ${count('fail')} failing.`,
  );
  if (count('fail'))
    lines.push(
      'A failing URL (DNS, TLS, 5xx, non-https) must be fixed or removed in src/lib/provider-links.ts (ADR-012 §6.3).',
    );
  return lines.join('\n');
}

export function exitCodeFor(results: LinkResult[]): number {
  return results.some((r) => r.verdict === 'fail') ? 1 : 0;
}
