/**
 * Review, watchlist and profile use cases (API_CONTRACT §5.11, §5.12, §5.14, §5.17). OWNER: Backend.
 * One review per (user, title); a linked stub must be the same user's stub of the same title.
 */
import type { z } from 'zod';
import type {
  ProfileResponse,
  ReviewUpsertResponse,
  updateProfileSchema,
  upsertReviewSchema,
} from '@/lib/contracts';
import { AppError } from '@/lib/errors';
import { toTitleKey } from '@/lib/keys';
import type { MediaType, Session, TitleKey } from '@/lib/types';
import type { Container } from '@/server/ports';
import { titleStateFor } from './stubs';

async function requireTitle(c: Pick<Container, 'catalog'>, mediaType: MediaType, tmdbId: number) {
  const title = await c.catalog.get(mediaType, tmdbId);
  if (!title) throw new AppError('not_found', "This ticket doesn't exist.");
  return title;
}

export async function upsertReview(
  c: Container,
  session: Session,
  input: z.output<typeof upsertReviewSchema>,
  today: string,
): Promise<ReviewUpsertResponse> {
  const key = toTitleKey(input.mediaType, input.tmdbId);
  await requireTitle(c, input.mediaType, input.tmdbId);
  const stubId = input.stubId ?? null;
  if (stubId) {
    const stub = await c.stubs.get(session.user.id, stubId);
    if (!stub || stub.titleKey !== key)
      throw new AppError('validation_failed', 'Please check the highlighted fields.', {
        fields: { stubId: 'That stub is not one of yours for this title.' },
      });
  }
  const { review, created } = await c.reviews.upsert({
    userId: session.user.id,
    titleKey: key,
    rating10: input.rating10,
    body: input.body,
    isSpoiler: input.isSpoiler,
    stubId,
  });
  const state = await titleStateFor(c, session.user.id, key, today);
  return { review, created, suggestStub: state.stubCount === 0 };
}

export async function deleteReview(c: Container, session: Session, id: string): Promise<void> {
  await c.reviews.delete(session.user.id, id);
}

export async function setWatchlisted(
  c: Container,
  session: Session,
  mediaType: MediaType,
  tmdbId: number,
  watchlisted: boolean,
): Promise<{ watchlisted: boolean; titleKey: TitleKey }> {
  const key = toTitleKey(mediaType, tmdbId);
  if (watchlisted) {
    await requireTitle(c, mediaType, tmdbId);
    await c.watchlist.add(session.user.id, key);
  } else {
    await c.watchlist.remove(session.user.id, key); // idempotent, also for unknown titles
  }
  return { watchlisted, titleKey: key };
}

export async function updateProfile(
  c: Container,
  session: Session,
  patch: z.output<typeof updateProfileSchema>,
): Promise<ProfileResponse> {
  if (patch.avatarUrl && !/^https:\/\//i.test(patch.avatarUrl))
    throw new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { avatarUrl: 'Use an https:// image link.' },
    });
  // Only whitelisted columns; the handle is immutable (B3-AC2, column grants in live mode).
  const profile = await c.profiles.update(session.user.id, {
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
    ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
  });
  return { profile };
}
