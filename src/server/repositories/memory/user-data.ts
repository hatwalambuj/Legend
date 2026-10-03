/**
 * Demo-mode user data repositories over the JSON store (ADR-006). OWNER: Backend.
 *
 * Mirrors the SQL schema, triggers and RLS of supabase/migrations exactly:
 * - every write is scoped to `userId` (someone else's row behaves like a missing row → not_found),
 * - stubs are append-only watch events (count = rows); `Stub.number` = 1-based rank by
 *   (watchedOn, createdAt, id) within (user, title),
 * - one review per (user, title); `editedAt` is set when rating, body or spoiler flag change,
 * - rate limits (RATE_LIMIT_STUBS_PER_MIN / RATE_LIMIT_REVIEWS_PER_MIN) are checked inside the same
 *   synchronous store mutation as the write (atomic within the process, like the DB trigger),
 * - title stats are aggregates over the rows (live: trigger-maintained `title_stats`),
 * - lists are keyset-paginated with the same orders as the SQL indexes (src/server/cursor.ts).
 * Every list/read resolves titles in one pass (no per-row lookups).
 */
import { randomUUID } from 'node:crypto';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type {
  DiaryEntry,
  Page,
  ProfileStats,
  PublicProfile,
  Review,
  ReviewSort,
  ReviewWithTitle,
  Stub,
  TitleKey,
  TitleState,
  TitleStats,
  TitleSummary,
  AvatarColor,
  ImportSource,
  TypeFilter,
  WalletItem,
  WatchedWhere,
} from '@/lib/types';
import { keysetPage } from '@/server/cursor';
import { env } from '@/server/env';
import type {
  EventCount,
  EventRepository,
  ImportApplyRow,
  ImportExisting,
  ImportRepository,
  ProfileRepository,
  ReviewRepository,
  StubRepository,
  TitleStateRepository,
  UserSettingsRepository,
  WatchlistRepository,
} from '@/server/ports';
import { assertUnderLimit } from '@/server/rate-limit';
import { averageOrNull, emptyTitleState } from '@/server/stats';
import type { FixtureReview } from '@/fixtures/schema';
import { summaryByKey } from './catalog';
import { demoStore, type DemoData, type DemoStub, type DemoUser } from './store';

/* ------------------------------------------------------------------ */
/* Shared helpers (pure over a DemoData snapshot)                      */
/* ------------------------------------------------------------------ */

/**
 * Strictly increasing timestamps within the process, so two writes in the same millisecond still
 * order (and number) by insertion — Postgres gets this from microsecond `now()`.
 */
let lastMs = 0;
const nowIso = () => {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return new Date(lastMs).toISOString();
};

export function toPublicProfile(u: DemoUser): PublicProfile {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt,
    avatarColor: u.avatarColor ?? null,
  };
}

/** Chronological order of watches: (watchedOn, createdAt, id) ascending. */
function watchOrder(a: DemoStub, b: DemoStub): number {
  if (a.watchedOn !== b.watchedOn) return a.watchedOn < b.watchedOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `Stub.number` for every stub of one user (one pass, grouped by title). */
function stubNumbers(d: DemoData, userId: string): Map<string, number> {
  const byTitle = new Map<TitleKey, DemoStub[]>();
  for (const s of d.stubs) {
    if (s.userId !== userId) continue;
    const list = byTitle.get(s.titleKey);
    if (list) list.push(s);
    else byTitle.set(s.titleKey, [s]);
  }
  const out = new Map<string, number>();
  for (const list of byTitle.values())
    list.sort(watchOrder).forEach((s, i) => out.set(s.id, i + 1));
  return out;
}

function toStub(s: DemoStub, number: number): Stub {
  return {
    id: s.id,
    userId: s.userId,
    titleKey: s.titleKey,
    watchedOn: s.watchedOn,
    watchedWhere: s.watchedWhere,
    note: s.note,
    number,
    season: s.season ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function numberOf(d: DemoData, s: DemoStub): number {
  return stubNumbers(d, s.userId).get(s.id) ?? 1;
}

function toReview(
  r: FixtureReview,
  authors: Map<string, PublicProfile>,
  numbers: Map<string, number>,
): Review | null {
  const author = authors.get(r.userId);
  if (!author) return null;
  return {
    id: r.id,
    titleKey: r.titleKey,
    author,
    rating10: r.rating10,
    body: r.body,
    isSpoiler: r.isSpoiler,
    stubId: r.stubId,
    stubNumber: r.stubId ? (numbers.get(r.stubId) ?? null) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    editedAt: r.editedAt,
  };
}

function authorsById(d: DemoData, ids: Iterable<string>): Map<string, PublicProfile> {
  const want = new Set(ids);
  const m = new Map<string, PublicProfile>();
  for (const u of d.users) if (want.has(u.id)) m.set(u.id, toPublicProfile(u));
  return m;
}

/** Stub numbers for the stubs linked from `reviews` (grouped per author, one pass each). */
function numbersForReviews(d: DemoData, reviews: FixtureReview[]): Map<string, number> {
  const out = new Map<string, number>();
  const users = new Set(reviews.filter((r) => r.stubId).map((r) => r.userId));
  for (const u of users) for (const [k, v] of stubNumbers(d, u)) out.set(k, v);
  return out;
}

function reviewsToApi(d: DemoData, rows: FixtureReview[]): Review[] {
  const authors = authorsById(
    d,
    rows.map((r) => r.userId),
  );
  const numbers = numbersForReviews(d, rows);
  return rows.map((r) => toReview(r, authors, numbers)).filter((r): r is Review => r !== null);
}

const matchesType = (key: TitleKey, type: TypeFilter) =>
  type === 'all' || key.startsWith(`${type}:`);

function withTitle<T extends { titleKey: TitleKey }>(rows: T[]): (T & { title: TitleSummary })[] {
  const out: (T & { title: TitleSummary })[] = [];
  for (const r of rows) {
    const title = summaryByKey(r.titleKey);
    if (title) out.push({ ...r, title });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export class MemoryProfiles implements ProfileRepository {
  async getByHandle(handle: string): Promise<PublicProfile | null> {
    const h = handle.trim().toLowerCase();
    const u = demoStore()
      .get()
      .users.find((x) => x.handle === h);
    return u ? toPublicProfile(u) : null;
  }

  async getById(id: string): Promise<PublicProfile | null> {
    const u = demoStore()
      .get()
      .users.find((x) => x.id === id);
    return u ? toPublicProfile(u) : null;
  }

  async stats(userId: string, year: number): Promise<ProfileStats> {
    const d = demoStore().get();
    const mine = d.stubs.filter((s) => s.userId === userId);
    const perTitle = new Map<TitleKey, { count: number; last: string }>();
    for (const s of mine) {
      const cur = perTitle.get(s.titleKey);
      if (cur) {
        cur.count++;
        if (s.watchedOn > cur.last) cur.last = s.watchedOn;
      } else perTitle.set(s.titleKey, { count: 1, last: s.watchedOn });
    }
    let most: { key: TitleKey; count: number; last: string } | null = null;
    for (const [key, v] of perTitle) {
      if (
        !most ||
        v.count > most.count ||
        (v.count === most.count && (v.last > most.last || (v.last === most.last && key < most.key)))
      )
        most = { key, ...v };
    }
    const mostTitle = most ? summaryByKey(most.key) : undefined;
    const prefix = `${year}-`;
    return {
      totalStubs: mine.length,
      stubsThisYear: mine.filter((s) => s.watchedOn.startsWith(prefix)).length,
      rewatches: mine.length - perTitle.size,
      titlesStubbed: perTitle.size,
      reviewCount: d.reviews.filter((r) => r.userId === userId).length,
      mostStubbed: most && mostTitle ? { title: mostTitle, count: most.count } : null,
    };
  }

  async update(
    userId: string,
    patch: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string | null;
      avatarColor?: AvatarColor | null;
    },
  ): Promise<PublicProfile> {
    return demoStore().mutate((d) => {
      const u = d.users.find((x) => x.id === userId);
      if (!u) throw new AppError('not_found', 'Profile not found.');
      if (patch.displayName !== undefined) u.displayName = patch.displayName;
      if (patch.bio !== undefined) u.bio = patch.bio;
      if (patch.avatarUrl !== undefined) u.avatarUrl = patch.avatarUrl;
      if (patch.avatarColor !== undefined) u.avatarColor = patch.avatarColor;
      return toPublicProfile(u);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Stubs                                                               */
/* ------------------------------------------------------------------ */

export class MemoryStubs implements StubRepository {
  async create(input: {
    userId: string;
    titleKey: TitleKey;
    watchedOn: string;
    watchedWhere: WatchedWhere | null;
    note: string;
    season?: number | null;
  }): Promise<Stub> {
    return demoStore().mutate((d) => {
      // Like the v1.6 trigger: only `source='app'` stubs count, so an import never locks out stubbing.
      assertUnderLimit(
        d.stubs
          .filter((s) => s.userId === input.userId && s.source !== 'import')
          .map((s) => s.createdAt),
        env().rateLimits.stubsPerMin,
        ERROR_COPY.rate_limited_stub,
      );
      const now = nowIso();
      const row: DemoStub = {
        id: randomUUID(),
        userId: input.userId,
        titleKey: input.titleKey,
        watchedOn: input.watchedOn,
        watchedWhere: input.watchedWhere,
        note: input.note,
        season: input.season ?? null,
        source: 'app',
        createdAt: now,
        updatedAt: now,
      };
      d.stubs.push(row);
      return toStub(row, numberOf(d, row));
    });
  }

  async update(
    userId: string,
    id: string,
    patch: {
      watchedOn?: string;
      watchedWhere?: WatchedWhere | null;
      note?: string;
      season?: number | null;
    },
  ): Promise<Stub> {
    return demoStore().mutate((d) => {
      const row = d.stubs.find((s) => s.id === id && s.userId === userId);
      if (!row) throw new AppError('not_found', "This stub doesn't exist.");
      if (patch.watchedOn !== undefined) row.watchedOn = patch.watchedOn;
      if (patch.watchedWhere !== undefined) row.watchedWhere = patch.watchedWhere;
      if (patch.note !== undefined) row.note = patch.note;
      if (patch.season !== undefined) row.season = patch.season;
      row.updatedAt = nowIso();
      return toStub(row, numberOf(d, row));
    });
  }

  async delete(userId: string, id: string): Promise<Stub> {
    return demoStore().mutate((d) => {
      const i = d.stubs.findIndex((s) => s.id === id && s.userId === userId);
      const row = d.stubs[i];
      if (i < 0 || !row) throw new AppError('not_found', "This stub doesn't exist.");
      const number = numberOf(d, row);
      d.stubs.splice(i, 1);
      // FK `reviews.stub_id … on delete set null`.
      for (const r of d.reviews) if (r.stubId === id) r.stubId = null;
      return toStub(row, number);
    });
  }

  async get(userId: string, id: string): Promise<Stub | null> {
    const d = demoStore().get();
    const row = d.stubs.find((s) => s.id === id && s.userId === userId);
    return row ? toStub(row, numberOf(d, row)) : null;
  }

  async getById(id: string): Promise<Stub | null> {
    const d = demoStore().get();
    const row = d.stubs.find((s) => s.id === id);
    return row ? toStub(row, numberOf(d, row)) : null;
  }

  async diary(
    userId: string,
    opts: { type: TypeFilter; cursor?: string | null; limit: number },
  ): Promise<Page<DiaryEntry> & { total: number }> {
    const d = demoStore().get();
    const numbers = stubNumbers(d, userId);
    const rows = d.stubs.filter((s) => s.userId === userId && matchesType(s.titleKey, opts.type));
    // Resolve titles first so the page never contains holes; order = SQL index stubs_diary.
    const resolved = withTitle(rows);
    const page = keysetPage(resolved, {
      kind: 'diary',
      dirs: [-1, -1, 1],
      tupleOf: (s) => [s.watchedOn, s.createdAt, s.id],
      cursor: opts.cursor,
      limit: opts.limit,
    });
    return {
      items: page.items.map((s) => ({ ...toStub(s, numbers.get(s.id) ?? 1), title: s.title })),
      nextCursor: page.nextCursor,
      total: resolved.length,
    };
  }

  async count(userId: string, type: TypeFilter = 'all'): Promise<number> {
    let n = 0;
    for (const s of demoStore().get().stubs)
      if (s.userId === userId && matchesType(s.titleKey, type)) n++;
    return n;
  }

  async wallet(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<WalletItem>> {
    const d = demoStore().get();
    const groups = new Map<
      TitleKey,
      { titleKey: TitleKey; count: number; lastWatchedOn: string; lastCreatedAt: string }
    >();
    for (const s of d.stubs) {
      if (s.userId !== userId) continue;
      const g = groups.get(s.titleKey);
      if (!g)
        groups.set(s.titleKey, {
          titleKey: s.titleKey,
          count: 1,
          lastWatchedOn: s.watchedOn,
          lastCreatedAt: s.createdAt,
        });
      else {
        g.count++;
        if (s.watchedOn > g.lastWatchedOn) g.lastWatchedOn = s.watchedOn;
        if (s.createdAt > g.lastCreatedAt) g.lastCreatedAt = s.createdAt;
      }
    }
    const page = keysetPage(withTitle([...groups.values()]), {
      kind: 'wallet',
      dirs: [-1, -1, 1],
      tupleOf: (g) => [g.lastWatchedOn, g.lastCreatedAt, g.titleKey],
      cursor: opts.cursor,
      limit: opts.limit,
    });
    return {
      items: page.items.map((g) => ({
        title: g.title,
        count: g.count,
        lastWatchedOn: g.lastWatchedOn,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async countRecent(userId: string, sinceIso: string): Promise<number> {
    return demoStore()
      .get()
      .stubs.filter((s) => s.userId === userId && s.createdAt > sinceIso).length;
  }
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export class MemoryReviews implements ReviewRepository {
  async upsert(input: {
    userId: string;
    titleKey: TitleKey;
    rating10: number;
    body: string;
    isSpoiler: boolean;
    stubId: string | null;
  }): Promise<{ review: Review; created: boolean }> {
    return demoStore().mutate((d) => {
      if (
        input.stubId &&
        !d.stubs.some(
          (s) =>
            s.id === input.stubId && s.userId === input.userId && s.titleKey === input.titleKey,
        )
      )
        // Same rule as the `reviews_before_write` trigger (stub_mismatch).
        throw new AppError('validation_failed', 'Please check the highlighted fields.', {
          fields: { stubId: 'That stub is not one of yours for this title.' },
        });
      const existing = d.reviews.find(
        (r) => r.userId === input.userId && r.titleKey === input.titleKey,
      );
      const changed =
        !existing ||
        existing.rating10 !== input.rating10 ||
        existing.body !== input.body ||
        existing.isSpoiler !== input.isSpoiler;
      // Inserts + content edits count (trigger: updated_at within 1 minute, excluding the row being
      // edited); a re-save or stub re-link does not.
      if (changed)
        assertUnderLimit(
          d.reviews
            .filter((r) => r.userId === input.userId && r !== existing)
            .map((r) => r.updatedAt),
          env().rateLimits.reviewsPerMin,
          ERROR_COPY.rate_limited_review,
        );
      const now = nowIso();
      let row: FixtureReview;
      let created: boolean;
      if (existing) {
        existing.rating10 = input.rating10;
        existing.body = input.body;
        existing.isSpoiler = input.isSpoiler;
        existing.stubId = input.stubId;
        existing.updatedAt = now;
        if (changed) existing.editedAt = now;
        row = existing;
        created = false;
      } else {
        row = {
          id: randomUUID(),
          userId: input.userId,
          titleKey: input.titleKey,
          rating10: input.rating10,
          body: input.body,
          isSpoiler: input.isSpoiler,
          stubId: input.stubId,
          createdAt: now,
          updatedAt: now,
          editedAt: null,
        };
        d.reviews.push(row);
        created = true;
      }
      const [review] = reviewsToApi(d, [row]);
      if (!review) throw new AppError('not_found', 'Profile not found.');
      return { review, created };
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    demoStore().mutate((d) => {
      const i = d.reviews.findIndex((r) => r.id === id && r.userId === userId);
      if (i < 0) throw new AppError('not_found', "This review doesn't exist.");
      d.reviews.splice(i, 1);
    });
  }

  async listForTitle(
    titleKey: TitleKey,
    opts: { sort: ReviewSort; cursor?: string | null; limit: number },
  ): Promise<Page<Review>> {
    const d = demoStore().get();
    const rows = d.reviews.filter((r) => r.titleKey === titleKey);
    // Orders = SQL indexes reviews_title_newest / reviews_title_highest.
    const page =
      opts.sort === 'highest'
        ? keysetPage(rows, {
            kind: 'reviews:highest',
            dirs: [-1, -1, 1],
            tupleOf: (r) => [r.rating10, r.createdAt, r.id],
            cursor: opts.cursor,
            limit: opts.limit,
          })
        : keysetPage(rows, {
            kind: 'reviews:newest',
            dirs: [-1, 1],
            tupleOf: (r) => [r.createdAt, r.id],
            cursor: opts.cursor,
            limit: opts.limit,
          });
    return { items: reviewsToApi(d, page.items), nextCursor: page.nextCursor };
  }

  async listForUser(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<ReviewWithTitle>> {
    const d = demoStore().get();
    const page = keysetPage(withTitle(d.reviews.filter((r) => r.userId === userId)), {
      kind: 'user-reviews',
      dirs: [-1, 1],
      tupleOf: (r) => [r.createdAt, r.id],
      cursor: opts.cursor,
      limit: opts.limit,
    });
    const api = reviewsToApi(d, page.items);
    return {
      items: api.map((r, i) => ({ ...r, title: page.items[i]!.title })),
      nextCursor: page.nextCursor,
    };
  }

  async countRecent(userId: string, sinceIso: string): Promise<number> {
    return demoStore()
      .get()
      .reviews.filter((r) => r.userId === userId && r.updatedAt > sinceIso).length;
  }
}

/* ------------------------------------------------------------------ */
/* Watchlist                                                           */
/* ------------------------------------------------------------------ */

export class MemoryWatchlist implements WatchlistRepository {
  async add(userId: string, titleKey: TitleKey): Promise<void> {
    demoStore().mutate((d) => {
      if (!d.watchlist.some((w) => w.userId === userId && w.titleKey === titleKey))
        d.watchlist.push({ userId, titleKey, addedAt: nowIso() });
    });
  }

  async remove(userId: string, titleKey: TitleKey): Promise<void> {
    demoStore().mutate((d) => {
      d.watchlist = d.watchlist.filter((w) => !(w.userId === userId && w.titleKey === titleKey));
    });
  }

  async list(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<TitleSummary>> {
    const d = demoStore().get();
    const page = keysetPage(withTitle(d.watchlist.filter((w) => w.userId === userId)), {
      kind: 'watchlist',
      dirs: [-1, 1],
      tupleOf: (w) => [w.addedAt, w.titleKey],
      cursor: opts.cursor,
      limit: opts.limit,
    });
    return { items: page.items.map((w) => w.title), nextCursor: page.nextCursor };
  }
}

/* ------------------------------------------------------------------ */
/* Title states + community stats                                      */
/* ------------------------------------------------------------------ */

export class MemoryTitleStates implements TitleStateRepository {
  async states(
    userId: string,
    keys: TitleKey[],
    today: string,
  ): Promise<Record<TitleKey, TitleState>> {
    const d = demoStore().get();
    const out: Record<TitleKey, TitleState> = {};
    const want = new Set(keys);
    for (const k of want) out[k] = emptyTitleState();
    for (const s of d.stubs) {
      if (s.userId !== userId || !want.has(s.titleKey)) continue;
      const st = out[s.titleKey]!;
      st.stubCount++;
      if (!st.lastWatchedOn || s.watchedOn > st.lastWatchedOn) st.lastWatchedOn = s.watchedOn;
      if (s.watchedOn === today) st.hasStubToday = true;
    }
    for (const w of d.watchlist)
      if (w.userId === userId && want.has(w.titleKey)) out[w.titleKey]!.watchlisted = true;
    const mine = d.reviews.filter((r) => r.userId === userId && want.has(r.titleKey));
    for (const r of reviewsToApi(d, mine)) out[r.titleKey]!.myReview = r;
    return out;
  }

  async stats(titleKey: TitleKey): Promise<TitleStats> {
    const d = demoStore().get();
    let stubCount = 0;
    for (const s of d.stubs) if (s.titleKey === titleKey) stubCount++;
    let sum = 0;
    let count = 0;
    for (const r of d.reviews)
      if (r.titleKey === titleKey) {
        sum += r.rating10;
        count++;
      }
    return {
      stubCount,
      reviewCount: count,
      ratingCount: count,
      ratingAvg10: averageOrNull(sum, count),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Settings (ADR-012 §7): owner-only, mirrors public.user_settings     */
/* ------------------------------------------------------------------ */

/** The saved watch region of a demo user (null = automatic / none saved). */
export function demoWatchRegion(d: DemoData, userId: string): string | null {
  return d.settings?.find((x) => x.userId === userId)?.watchRegion ?? null;
}

export class MemorySettings implements UserSettingsRepository {
  async get(userId: string): Promise<{ watchRegion: string | null }> {
    return { watchRegion: demoWatchRegion(demoStore().get(), userId) };
  }

  async setWatchRegion(userId: string, region: string | null): Promise<void> {
    if (region !== null && !/^[A-Z]{2}$/.test(region))
      throw new AppError('validation_failed', 'Please check the highlighted fields.', {
        fields: { region: 'Use a two-letter country code' },
      });
    demoStore().mutate((d) => {
      if (!d.users.some((u) => u.id === userId))
        throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
      const list = (d.settings ??= []);
      const row = list.find((x) => x.userId === userId);
      if (row) {
        row.watchRegion = region;
        row.updatedAt = nowIso();
      } else list.push({ userId, watchRegion: region, updatedAt: nowIso() });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Analytics (ADR-013 C-09): anonymous daily counters, no ids           */
/* ------------------------------------------------------------------ */

export class MemoryEvents implements EventRepository {
  async track(rows: EventCount[]): Promise<void> {
    if (rows.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    demoStore().mutate((d) => {
      const ev = (d.events ??= {});
      for (const r of rows.slice(0, 50)) {
        const k = `${day}|${r.name}|${r.dim}`;
        ev[k] = (ev[k] ?? 0) + Math.max(0, Math.floor(r.n));
      }
    });
  }
}

/** Demo counters for one day (tests, scripts). */
export function demoEventCounts(day: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(demoStore().get().events ?? {})) {
    const [d, name, dim] = k.split('|');
    if (d === day) out[dim ? `${name}:${dim}` : name!] = n;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Imports (ADR-013 C-11): mirror of rpc import_apply                   */
/* ------------------------------------------------------------------ */

export class MemoryImports implements ImportRepository {
  async existing(userId: string, keys: TitleKey[]): Promise<ImportExisting> {
    const d = demoStore().get();
    const want = new Set(keys);
    const out: ImportExisting = { stubDays: new Set(), reviewed: new Set() };
    for (const s of d.stubs)
      if (s.userId === userId && want.has(s.titleKey))
        out.stubDays.add(`${s.titleKey}|${s.watchedOn}`);
    for (const r of d.reviews)
      if (r.userId === userId && want.has(r.titleKey)) out.reviewed.add(r.titleKey);
    return out;
  }

  async importedSince(userId: string, sinceIso: string): Promise<number> {
    return demoStore()
      .get()
      .stubs.filter((s) => s.userId === userId && s.source === 'import' && s.createdAt > sinceIso)
      .length;
  }

  async apply(
    userId: string,
    _source: ImportSource,
    rows: ImportApplyRow[],
  ): Promise<{ stubs: number; reviews: number }> {
    return demoStore().mutate((d) => {
      if (!d.users.some((u) => u.id === userId))
        throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
      const keys = new Set(
        d.stubs.filter((s) => s.userId === userId && s.importKey).map((s) => s.importKey!),
      );
      const reviewed = new Set(d.reviews.filter((r) => r.userId === userId).map((r) => r.titleKey));
      let stubs = 0;
      let reviews = 0;
      for (const r of rows.slice(0, 1000)) {
        if (r.watchedOn && r.importKey && !keys.has(r.importKey)) {
          const now = nowIso();
          d.stubs.push({
            id: randomUUID(),
            userId,
            titleKey: r.titleKey,
            watchedOn: r.watchedOn,
            watchedWhere: null,
            note: '',
            season: r.season,
            source: 'import',
            importKey: r.importKey,
            createdAt: now,
            updatedAt: now,
          });
          keys.add(r.importKey);
          stubs++;
        }
        if (r.rating10 !== null && !reviewed.has(r.titleKey)) {
          const now = nowIso();
          d.reviews.push({
            id: randomUUID(),
            userId,
            titleKey: r.titleKey,
            rating10: r.rating10,
            body: r.body,
            isSpoiler: r.isSpoiler,
            stubId: null,
            createdAt: now,
            updatedAt: now,
            editedAt: null,
          });
          reviewed.add(r.titleKey);
          reviews++;
        }
      }
      return { stubs, reviews };
    });
  }
}
