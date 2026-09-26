import { container } from '@/server/container';
import { env } from '@/server/env';
import { json, route } from '@/server/http';
import type { HealthResponse } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const c = container();
  const m = env().mode;
  const body: HealthResponse = {
    ok: true,
    mode: { catalog: m.catalog, data: m.data, isDemo: m.isDemo },
    catalogCount: await c.catalog.count(),
    lastSyncAt: await c.catalog.lastSyncAt(),
  };
  return json(body);
});
