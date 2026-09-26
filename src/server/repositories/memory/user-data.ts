/**
 * Demo-mode user data repositories over the JSON store. OWNER: Backend. SKELETON.
 * Read paths that pages need on day one return empty/neutral values so the Frontend can build
 * screens immediately; every mutation throws not_implemented until Backend implements it.
 *
 * Invariants to preserve when implementing (mirror the SQL schema + RLS):
 * - every write filters by userId (no cross-user writes), stubs are append-only rows (count = rows),
 * - one review per (userId, titleKey), rating10 in 1..10, body <= 5000, note <= 280,
 * - `Stub.number` = 1-based rank by (watchedOn, createdAt) within (userId, titleKey),
 * - rate limits: RATE_LIMIT_STUBS_PER_MIN / RATE_LIMIT_REVIEWS_PER_MIN → AppError('rate_limited', …, { retryAfter: 60 }).
 */
import type {
  Page,
  ProfileStats,
  PublicProfile,
  TitleKey,
  TitleState,
  TitleStats,
} from '@/lib/types';
import type {
  ProfileRepository,
  ReviewRepository,
  StubRepository,
  TitleStateRepository,
  WatchlistRepository,
} from '@/server/ports';
import { notImplemented } from '../not-implemented';
import { demoStore } from './store';

const empty = <T>(): Page<T> => ({ items: [], nextCursor: null });

export class MemoryProfiles implements ProfileRepository {
  async getByHandle(handle: string): Promise<PublicProfile | null> {
    const u = demoStore()
      .get()
      .users.find((x) => x.handle === handle.toLowerCase());
    return u
      ? {
          id: u.id,
          handle: u.handle,
          displayName: u.displayName,
          bio: u.bio,
          avatarUrl: u.avatarUrl,
          createdAt: u.createdAt,
        }
      : null;
  }
  async getById(id: string): Promise<PublicProfile | null> {
    const u = demoStore()
      .get()
      .users.find((x) => x.id === id);
    return u
      ? {
          id: u.id,
          handle: u.handle,
          displayName: u.displayName,
          bio: u.bio,
          avatarUrl: u.avatarUrl,
          createdAt: u.createdAt,
        }
      : null;
  }
  async stats(): Promise<ProfileStats> {
    return {
      totalStubs: 0,
      stubsThisYear: 0,
      rewatches: 0,
      titlesStubbed: 0,
      reviewCount: 0,
      mostStubbed: null,
    };
  }
  async update(): Promise<PublicProfile> {
    return notImplemented('MemoryProfiles.update');
  }
}

export class MemoryStubs implements StubRepository {
  create = () => notImplemented('MemoryStubs.create');
  update = () => notImplemented('MemoryStubs.update');
  delete = () => notImplemented('MemoryStubs.delete');
  get = async () => null;
  diary = async () => empty<never>();
  wallet = async () => empty<never>();
  countRecent = async () => 0;
}

export class MemoryReviews implements ReviewRepository {
  upsert = () => notImplemented('MemoryReviews.upsert');
  delete = () => notImplemented('MemoryReviews.delete');
  setImdbShared = () => notImplemented('MemoryReviews.setImdbShared');
  listForTitle = async () => empty<never>();
  listForUser = async () => empty<never>();
  countRecent = async () => 0;
}

export class MemoryWatchlist implements WatchlistRepository {
  add = () => notImplemented('MemoryWatchlist.add');
  remove = () => notImplemented('MemoryWatchlist.remove');
  list = async () => empty<never>();
}

export class MemoryTitleStates implements TitleStateRepository {
  async states(): Promise<Record<TitleKey, TitleState>> {
    return {};
  }
  async stats(): Promise<TitleStats> {
    return { stubCount: 0, reviewCount: 0, ratingAvg10: null, ratingCount: 0 };
  }
}
