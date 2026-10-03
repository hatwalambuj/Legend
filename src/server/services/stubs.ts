/**
 * Stub use cases (API_CONTRACT §5.7–§5.9). Business rules live here so both data modes share them;
 * repositories enforce ownership + rate limits at the write (DB trigger / memory store).
 * OWNER: Backend.
 */
import type { z } from 'zod';
import type {
  StubDeleteResponse,
  StubMutationResponse,
  createStubSchema,
  updateStubSchema,
} from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { parseTitleKey, toTitleKey } from '@/lib/keys';
import type { Session, TitleKey, TitleState, TitleSummary } from '@/lib/types';
import type { Container } from '@/server/ports';
import { SEASON_ON_MOVIE, SEASON_TOO_HIGH } from '@/server/repositories/supabase/rows';
import { emptyTitleState } from '@/server/stats';

export const WATCHED_ON_FUTURE = "That date hasn't happened yet.";
export const WATCHED_ON_TOO_EARLY = 'That date is before this title came out.';

/** Adds `days` to a 'YYYY-MM-DD' date (UTC calendar arithmetic). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * ADR-004 §2: no future dates, nothing before Jan 1 of (release year − 1). Like the `stubs_before_write`
 * trigger, "future" allows one day of slack for users ahead of UTC (their "today" is our tomorrow).
 */
export function validateWatchedOn(
  watchedOn: string,
  title: Pick<TitleSummary, 'releaseDate' | 'year'>,
  today: string,
): void {
  if (watchedOn > addDays(today, 1))
    throw new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { watchedOn: WATCHED_ON_FUTURE },
    });
  const year = title.year || Number(title.releaseDate?.slice(0, 4));
  if (Number.isFinite(year) && year > 0) {
    const min = `${String(year - 1).padStart(4, '0')}-01-01`;
    if (watchedOn < min)
      throw new AppError('validation_failed', 'Please check the highlighted fields.', {
        fields: { watchedOn: WATCHED_ON_TOO_EARLY },
      });
  }
}

/**
 * v1.6 (ADR-013 C-10): a season only on a TV title, and not above its `seasonCount` when known
 * (range 1..200 is the zod schema; the DB trigger/check repeat the movie + range rules).
 */
export function validateSeason(
  season: number | null | undefined,
  title: Pick<TitleSummary, 'mediaType' | 'seasonCount'>,
): void {
  if (season === null || season === undefined) return;
  const bad = (msg: string) =>
    new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { season: msg },
    });
  if (title.mediaType !== 'tv') throw bad(SEASON_ON_MOVIE);
  if (title.seasonCount !== null && season > title.seasonCount) throw bad(SEASON_TOO_HIGH);
}

export async function titleStateFor(
  c: Pick<Container, 'titleStates'>,
  userId: string,
  key: TitleKey,
  today: string,
): Promise<TitleState> {
  const states = await c.titleStates.states(userId, [key], today);
  return states[key] ?? emptyTitleState();
}

async function requireTitle(c: Pick<Container, 'catalog'>, key: TitleKey): Promise<TitleSummary> {
  const ref = parseTitleKey(key);
  const title = ref ? await c.catalog.get(ref.mediaType, ref.tmdbId) : null;
  if (!title) throw new AppError('not_found', "This ticket doesn't exist.");
  return title;
}

export async function createStub(
  c: Container,
  session: Session,
  input: z.output<typeof createStubSchema>,
  today: string,
): Promise<StubMutationResponse> {
  const key = toTitleKey(input.mediaType, input.tmdbId);
  const title = await requireTitle(c, key);
  const watchedOn = input.watchedOn ?? today;
  validateWatchedOn(watchedOn, title, today);
  validateSeason(input.season, title);
  // A same-day duplicate is allowed (double feature); the UI confirms first via state.hasStubToday.
  const stub = await c.stubs.create({
    userId: session.user.id,
    titleKey: key,
    watchedOn,
    watchedWhere: input.watchedWhere ?? null,
    note: input.note,
    season: input.season ?? null,
  });
  return { stub, state: await titleStateFor(c, session.user.id, key, today) };
}

export async function updateStub(
  c: Container,
  session: Session,
  id: string,
  patch: z.output<typeof updateStubSchema>,
  today: string,
): Promise<StubMutationResponse> {
  const existing = await c.stubs.get(session.user.id, id);
  if (!existing) throw new AppError('not_found', "This stub doesn't exist.");
  if (patch.watchedOn !== undefined || (patch.season !== undefined && patch.season !== null)) {
    const title = await requireTitle(c, existing.titleKey);
    if (patch.watchedOn !== undefined) validateWatchedOn(patch.watchedOn, title, today);
    validateSeason(patch.season, title);
  }
  const stub = await c.stubs.update(session.user.id, id, {
    ...(patch.watchedOn !== undefined ? { watchedOn: patch.watchedOn } : {}),
    ...(patch.watchedWhere !== undefined ? { watchedWhere: patch.watchedWhere } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.season !== undefined ? { season: patch.season } : {}),
  });
  return { stub, state: await titleStateFor(c, session.user.id, stub.titleKey, today) };
}

export async function deleteStub(
  c: Container,
  session: Session,
  id: string,
  today: string,
): Promise<StubDeleteResponse & { titleKey: TitleKey }> {
  const removed = await c.stubs.delete(session.user.id, id);
  return {
    titleKey: removed.titleKey,
    state: await titleStateFor(c, session.user.id, removed.titleKey, today),
  };
}
