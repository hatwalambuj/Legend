import { titleStatesQuerySchema, type TitleStatesResponse } from '@/lib/contracts';
import { dal } from '@/server/dal';
import { json, parseQuery, route } from '@/server/http';

export const GET = route(async (req) => {
  const { keys } = parseQuery(req, titleStatesQuerySchema);
  const body: TitleStatesResponse = { states: await dal.myTitleStates(keys) };
  return json(body);
});
