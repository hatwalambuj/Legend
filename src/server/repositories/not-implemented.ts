import { AppError } from '@/lib/errors';

/** Placeholder for repository methods Backend still has to implement. */
export function notImplemented(what: string): never {
  throw new AppError('not_implemented', `${what} is not implemented yet.`);
}
