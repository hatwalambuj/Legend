import { diaryQuerySchema } from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { dal } from '@/server/dal';
import { notImplementedRoute, parseQuery, route } from '@/server/http';

// TODO(Backend): return DiaryResponse for the signed-in user.
export const GET = route(async (req) => {
  parseQuery(req, diaryQuerySchema);
  if (!(await dal.getSession()))
    throw new AppError('unauthenticated', 'Sign in to see your stubs.');
  return notImplementedRoute();
});
