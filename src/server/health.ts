/**
 * Honest health check (ADR-011 §3, API_CONTRACT §5.1 v1.4). Pure over an injected probe so every row of
 * the behaviour table is unit-tested; src/app/api/health/route.ts wires it to the container.
 * The body never carries error messages, hosts or stack traces; failures are logged by code only.
 * OWNER: Backend.
 */
import type { HealthReason, HealthResponse } from '@/lib/contracts';
import type { AppMode } from '@/lib/types';
import type { HealthProbe } from './ports';

export const HEALTH_PROBE_TIMEOUT_MS = 3000;

export interface HealthInput {
  mode: Pick<AppMode, 'catalog' | 'data' | 'isDemo'>;
  probe: (opts: { timeoutMs: number }) => Promise<HealthProbe>;
  maxSyncAgeHours: number;
  strict: boolean;
  now?: () => number;
  timeoutMs?: number;
}

/** Rejects after `ms` even if the underlying call ignores its abort signal (a hung socket). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health probe timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const errorCode = (e: unknown): string =>
  e instanceof Error
    ? ((e as { code?: unknown }).code as string | undefined) || e.name || 'error'
    : 'error';

export async function checkHealth(
  input: HealthInput,
): Promise<{ httpStatus: 200 | 503; body: HealthResponse }> {
  const mode = { catalog: input.mode.catalog, data: input.mode.data, isDemo: input.mode.isDemo };
  const timeoutMs = input.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;

  let probe: HealthProbe;
  try {
    probe = await withTimeout(input.probe({ timeoutMs }), timeoutMs);
  } catch (e) {
    if (!mode.isDemo) {
      console.error('[health] probe failed', { code: errorCode(e) });
      return {
        httpStatus: 503,
        body: {
          ok: false,
          status: 'down',
          mode,
          catalogCount: null,
          lastSyncAt: null,
          syncAgeHours: null,
          checks: { db: 'fail', sync: 'unknown' },
          reasons: ['db_unreachable'],
        },
      };
    }
    probe = { catalogCount: 0, lastFullSyncAt: null }; // demo has no DB: never reported as down
  }

  if (mode.isDemo)
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: 'ok',
        mode,
        catalogCount: probe.catalogCount,
        lastSyncAt: null,
        syncAgeHours: null,
        checks: { db: 'skipped', sync: 'skipped' },
        reasons: [],
      },
    };

  const reasons: HealthReason[] = [];
  const last = probe.lastFullSyncAt ? Date.parse(probe.lastFullSyncAt) : NaN;
  const ageHours = Number.isFinite(last)
    ? Math.max(0, Math.round(((input.now ?? Date.now)() - last) / 360_000) / 10)
    : null;
  let sync: HealthResponse['checks']['sync'] = 'ok';
  if (ageHours === null) {
    sync = 'never';
    reasons.push('sync_never');
  } else if (ageHours > input.maxSyncAgeHours) {
    sync = 'stale';
    reasons.push('sync_stale');
  }
  if (probe.catalogCount === 0) reasons.push('catalog_empty');
  const status = reasons.length ? 'degraded' : 'ok';
  return {
    httpStatus: status === 'degraded' && input.strict ? 503 : 200,
    body: {
      ok: status === 'ok',
      status,
      mode,
      catalogCount: probe.catalogCount,
      lastSyncAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
      syncAgeHours: ageHours,
      checks: { db: 'ok', sync },
      reasons,
    },
  };
}
