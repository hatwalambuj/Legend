import type { MeResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { json, route } from '@/server/http';

export const GET = route(async () => {
  const body: MeResponse = { session: await dal.getSession(), mode: dal.getMode() };
  return json(body);
});
