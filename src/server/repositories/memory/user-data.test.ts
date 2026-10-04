/**
 * Contract tests for the demo repositories (they mirror the SQL schema, triggers and RLS).
 * Each test starts from a fresh in-memory copy of src/fixtures/seed.json (DEMO_PERSIST=memory).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { TitleKey } from '@/lib/types';
import { resetEnvCache } from '@/server/env';
import { resetDemoStoreSingleton } from './store';
import {
  MemoryProfiles,
  MemoryReviews,
  MemoryStubs,
  MemoryTitleStates,
  MemoryWatchlist,
} from './user-data';

const MAYA = '00000000-0000-4000-8000-000000000001';
const DEV = '00000000-0000-4000-8000-000000000002';
const LEO = '00000000-0000-4000-8000-000000000006';
const DUNE: TitleKey = 'movie:693134';
const OFFICE: TitleKey = 'tv:2316';
const TRANSFORMERS: TitleKey = 'movie:1858';

const stubs = new MemoryStubs();
const reviews = new MemoryReviews();
const watchlist = new MemoryWatchlist();
const states = new MemoryTitleStates();
const profiles = new MemoryProfiles();

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
};

beforeEach(() => {
  resetEnvCache();
  resetDemoStoreSingleton();
});

describe('MemoryStubs', () => {
  it('appends watch events; count = rows; numbers follow (watchedOn, createdAt)', async () => {
    const a = await stubs.create({
      userId: LEO,
      titleKey: DUNE,
      watchedOn: '2026-09-20',
      watchedWhere: 'cinema',
      note: 'x',
    });
    const b = await stubs.create({
      userId: LEO,
      titleKey: DUNE,
      watchedOn: '2026-09-20',
      watchedWhere: null,
      note: '',
    });
    const early = await stubs.create({
      userId: LEO,
      titleKey: DUNE,
      watchedOn: '2024-03-01',
      watchedWhere: null,
      note: '',
    });
    expect([a.number, b.number, early.number]).toEqual([1, 2, 1]);
    expect((await stubs.get(LEO, a.id))!.number).toBe(2);
    expect((await stubs.get(LEO, b.id))!.number).toBe(3);
    const s = await states.states(LEO, [DUNE], '2026-09-20');
    expect(s[DUNE]).toMatchObject({
      stubCount: 3,
      lastWatchedOn: '2026-09-20',
      hasStubToday: true,
    });
  });

  it("never touches someone else's stub (not_found, like RLS)", async () => {
    const mine = await stubs.create({
      userId: LEO,
      titleKey: DUNE,
      watchedOn: '2026-09-20',
      watchedWhere: null,
      note: '',
    });
    expect(await stubs.get(MAYA, mine.id)).toBeNull();
    expect(await code(stubs.update(MAYA, mine.id, { note: 'hijack' }))).toBe('not_found');
    expect(await code(stubs.delete(MAYA, mine.id))).toBe('not_found');
    expect((await stubs.get(LEO, mine.id))!.note).toBe('');
  });

  it('updates fields and re-numbers; delete unlinks reviews (on delete set null)', async () => {
    const d = await stubs.diary(MAYA, { type: 'all', limit: 50 });
    const second = d.items.find((x) => x.titleKey === DUNE && x.number === 2)!;
    const moved = await stubs.update(MAYA, second.id, {
      watchedOn: '2024-03-05',
      note: 'first really',
    });
    expect(moved).toMatchObject({ number: 1, note: 'first really', watchedOn: '2024-03-05' });
    const before = await states.states(MAYA, [DUNE], '2026-09-26');
    expect(before[DUNE]!.myReview!.stubId).toBe(second.id);
    const removed = await stubs.delete(MAYA, second.id);
    expect(removed.id).toBe(second.id);
    const after = await states.states(MAYA, [DUNE], '2026-09-26');
    expect(after[DUNE]).toMatchObject({ stubCount: 1 });
    expect(after[DUNE]!.myReview!.stubId).toBeNull();
  });

  it('enforces the per-minute rate limit atomically with the write', async () => {
    for (let i = 0; i < 30; i++)
      await stubs.create({
        userId: LEO,
        titleKey: OFFICE,
        watchedOn: '2026-09-20',
        watchedWhere: null,
        note: '',
      });
    const err = await stubs
      .create({
        userId: LEO,
        titleKey: OFFICE,
        watchedOn: '2026-09-20',
        watchedWhere: null,
        note: '',
      })
      .catch((e: AppError) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('rate_limited');
    expect((err as AppError).retryAfter).toBeGreaterThan(0);
    expect(await stubs.countRecent(LEO, new Date(Date.now() - 60_000).toISOString())).toBe(30);
    // Other users are unaffected.
    expect(
      await code(
        stubs.create({
          userId: MAYA,
          titleKey: OFFICE,
          watchedOn: '2026-09-20',
          watchedWhere: null,
          note: '',
        }),
      ),
    ).toBe('ok');
  });

  it('diary: newest first, type filter, keyset pages cover every stub once', async () => {
    const all = await stubs.diary(DEV, { type: 'all', limit: 50 });
    expect(all.items).toHaveLength(12);
    const order = all.items.map((x) => `${x.watchedOn}|${x.createdAt}`);
    expect([...order].sort().reverse()).toEqual(order);
    expect(all.items.every((x) => x.title.key === x.titleKey)).toBe(true);
    const office = all.items.filter((x) => x.titleKey === OFFICE).map((x) => x.number);
    expect(office).toEqual([4, 3, 2, 1]);
    const tv = await stubs.diary(DEV, { type: 'tv', limit: 50 });
    expect(tv.items.every((x) => x.title.mediaType === 'tv')).toBe(true);
    // DiaryResponse.total / MeResponse.stubCount count the whole filter, not one page (contract v1.2).
    expect(all.total).toBe(12);
    expect(tv.total).toBe(tv.items.length);
    expect((await stubs.diary(DEV, { type: 'all', limit: 5 })).total).toBe(12);
    expect(await stubs.count(DEV)).toBe(12);
    expect(await stubs.count(DEV, 'tv')).toBe(tv.items.length);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const p: Awaited<ReturnType<typeof stubs.diary>> = await stubs.diary(DEV, {
        type: 'all',
        cursor,
        limit: 5,
      });
      ids.push(...p.items.map((x) => x.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(ids).toEqual(all.items.map((x) => x.id));
    expect(
      (await stubs.diary(DEV, { type: 'all', cursor: 'garbage', limit: 5 })).items[0]!.id,
    ).toBe(ids[0]);
  });

  it('wallet: one item per title with the stack count, newest last-watched first', async () => {
    const w = await stubs.wallet(DEV, { limit: 40 });
    expect(w.items).toHaveLength(6);
    expect(w.items.find((x) => x.title.key === OFFICE)!.count).toBe(4);
    const dates = w.items.map((x) => x.lastWatchedOn);
    expect([...dates].sort().reverse()).toEqual(dates);
    const p1 = await stubs.wallet(DEV, { limit: 4 });
    const p2 = await stubs.wallet(DEV, { cursor: p1.nextCursor, limit: 4 });
    expect([...p1.items, ...p2.items].map((x) => x.title.key)).toEqual(
      w.items.map((x) => x.title.key),
    );
    expect(p2.nextCursor).toBeNull();
    expect((await stubs.wallet(LEO, { limit: 40 })).items).toEqual([]);
  });

  it('wallet: latestStubId/latestSeason come from the last stub in watch order (v1.6.1)', async () => {
    const diary = await stubs.diary(DEV, { type: 'all', limit: 50 });
    const w = await stubs.wallet(DEV, { limit: 40 });
    for (const it of w.items) {
      const latest = diary.items.find((e) => e.titleKey === it.title.key)!; // diary is newest first
      expect(it.latestStubId).toBe(latest.id);
      expect(it.latestSeason).toBe(latest.season ?? null);
      expect(latest.number).toBe(it.count);
    }
    const s = await stubs.create({
      userId: DEV,
      titleKey: OFFICE,
      watchedOn: '2026-09-25',
      watchedWhere: null,
      note: '',
      season: 3,
    });
    const office = (await stubs.wallet(DEV, { limit: 40 })).items.find(
      (x) => x.title.key === OFFICE,
    )!;
    expect(office).toMatchObject({ latestStubId: s.id, latestSeason: 3, count: 5 });
  });
});

describe('MemoryReviews', () => {
  it('one review per (user, title): insert then update; editedAt only when content changes', async () => {
    const first = await reviews.upsert({
      userId: LEO,
      titleKey: DUNE,
      rating10: 8,
      body: 'Great',
      isSpoiler: false,
      stubId: null,
    });
    expect(first.created).toBe(true);
    expect(first.review).toMatchObject({ rating10: 8, editedAt: null, stubNumber: null });
    expect(first.review.author.handle).toBe('leo');
    const same = await reviews.upsert({
      userId: LEO,
      titleKey: DUNE,
      rating10: 8,
      body: 'Great',
      isSpoiler: false,
      stubId: null,
    });
    expect(same.created).toBe(false);
    expect(same.review.id).toBe(first.review.id);
    expect(same.review.editedAt).toBeNull();
    const edited = await reviews.upsert({
      userId: LEO,
      titleKey: DUNE,
      rating10: 9,
      body: 'Great!',
      isSpoiler: true,
      stubId: null,
    });
    expect(edited.review.editedAt).not.toBeNull();
    const list = await reviews.listForTitle(DUNE, { sort: 'newest', limit: 50 });
    expect(list.items.filter((r) => r.author.id === LEO)).toHaveLength(1);
  });

  it("rejects a stub that is not the user's stub of the same title", async () => {
    const mayaDune = (await stubs.diary(MAYA, { type: 'all', limit: 50 })).items.find(
      (x) => x.titleKey === DUNE,
    )!;
    expect(
      await code(
        reviews.upsert({
          userId: LEO,
          titleKey: DUNE,
          rating10: 5,
          body: '',
          isSpoiler: false,
          stubId: mayaDune.id,
        }),
      ),
    ).toBe('validation_failed');
    const mine = await stubs.create({
      userId: LEO,
      titleKey: OFFICE,
      watchedOn: '2026-09-01',
      watchedWhere: null,
      note: '',
    });
    expect(
      await code(
        reviews.upsert({
          userId: LEO,
          titleKey: DUNE,
          rating10: 5,
          body: '',
          isSpoiler: false,
          stubId: mine.id,
        }),
      ),
    ).toBe('validation_failed');
    const ok = await reviews.upsert({
      userId: LEO,
      titleKey: OFFICE,
      rating10: 5,
      body: '',
      isSpoiler: false,
      stubId: mine.id,
    });
    expect(ok.review.stubNumber).toBe(1);
  });

  it('lists newest / highest with keyset pages and pins the linked stub number', async () => {
    const newest = await reviews.listForTitle(DUNE, { sort: 'newest', limit: 50 });
    expect(newest.items).toHaveLength(5);
    const created = newest.items.map((r) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    const highest = await reviews.listForTitle(DUNE, { sort: 'highest', limit: 2 });
    expect(highest.items.map((r) => r.rating10)).toEqual([10, 9]);
    const next = await reviews.listForTitle(DUNE, {
      sort: 'highest',
      cursor: highest.nextCursor,
      limit: 10,
    });
    expect(next.items.map((r) => r.rating10)).toEqual([8, 8, 7]);
    // A cursor minted for another sort restarts at page 1.
    expect(
      (await reviews.listForTitle(DUNE, { sort: 'newest', cursor: highest.nextCursor, limit: 1 }))
        .items[0]!.id,
    ).toBe(newest.items[0]!.id);
    const maya = newest.items.find((r) => r.author.handle === 'maya')!;
    expect(maya.stubNumber).toBe(2);
  });

  it("deletes only the caller's own review", async () => {
    const r = (await reviews.listForTitle(DUNE, { sort: 'newest', limit: 50 })).items.find(
      (x) => x.author.id === MAYA,
    )!;
    expect(await code(reviews.delete(DEV, r.id))).toBe('not_found');
    await reviews.delete(MAYA, r.id);
    expect((await reviews.listForTitle(DUNE, { sort: 'newest', limit: 50 })).items).toHaveLength(4);
  });

  it('counts inserts and edits against the review rate limit', async () => {
    const keys: TitleKey[] = [
      'movie:238',
      'movie:157336',
      'tv:1396',
      'tv:2316',
      'movie:129',
      'movie:496243',
      'movie:872585',
      'tv:87108',
      'tv:76331',
      'tv:126308',
    ];
    for (const k of keys)
      await reviews.upsert({
        userId: LEO,
        titleKey: k,
        rating10: 7,
        body: '',
        isSpoiler: false,
        stubId: null,
      });
    expect(
      await code(
        reviews.upsert({
          userId: LEO,
          titleKey: DUNE,
          rating10: 7,
          body: '',
          isSpoiler: false,
          stubId: null,
        }),
      ),
    ).toBe('rate_limited');
    expect(await reviews.countRecent(LEO, new Date(Date.now() - 60_000).toISOString())).toBe(10);
  });

  it("lists a profile's reviews with titles", async () => {
    const p = await reviews.listForUser(DEV, { limit: 50 });
    expect(p.items.map((r) => r.title.key).sort()).toEqual([
      'movie:157336',
      'movie:1858',
      'movie:693134',
      'tv:2316',
    ]);
  });
});

describe('MemoryWatchlist + title states', () => {
  it('is idempotent and private to the user', async () => {
    await watchlist.add(LEO, DUNE);
    await watchlist.add(LEO, DUNE);
    await watchlist.add(LEO, OFFICE);
    const l = await watchlist.list(LEO, { limit: 10 });
    expect(l.items.map((t) => t.key).sort()).toEqual([DUNE, OFFICE].sort());
    expect((await watchlist.list(MAYA, { limit: 10 })).items.map((t) => t.key)).not.toContain(DUNE);
    await watchlist.remove(LEO, DUNE);
    await watchlist.remove(LEO, DUNE);
    expect((await watchlist.list(LEO, { limit: 10 })).items.map((t) => t.key)).toEqual([OFFICE]);
    const s = await states.states(LEO, [OFFICE, DUNE], '2026-09-26');
    expect(s[OFFICE]!.watchlisted).toBe(true);
    expect(s[DUNE]!.watchlisted).toBe(false);
  });

  it('returns a state for every requested key, with the own review', async () => {
    const s = await states.states(DEV, [OFFICE, DUNE, 'movie:238'], '2026-09-26');
    expect(Object.keys(s).sort()).toEqual(['movie:238', DUNE, OFFICE].sort());
    expect(s[OFFICE]).toMatchObject({ stubCount: 4, hasStubToday: false });
    expect(s[DUNE]).toMatchObject({ stubCount: 0 });
    expect(s[DUNE]!.myReview!.author.handle).toBe('dev');
    expect(s['movie:238']).toEqual({
      stubCount: 0,
      lastWatchedOn: null,
      hasStubToday: false,
      watchlisted: false,
      myReview: null,
    });
  });

  it('community stats unlock the average at 5 ratings (Dune) and drive Transformers low', async () => {
    const dune = await states.stats(DUNE);
    expect(dune).toMatchObject({ reviewCount: 5, ratingCount: 5, ratingAvg10: 8.4 });
    expect(dune.stubCount).toBeGreaterThanOrEqual(5);
    expect((await states.stats(TRANSFORMERS)).ratingAvg10).toBe(5);
    expect((await states.stats('movie:666277')).ratingAvg10).toBeNull(); // 1 rating
  });
});

describe('MemoryProfiles', () => {
  it('computes profile stats', async () => {
    const s = await profiles.stats(DEV, 2026);
    expect(s.totalStubs).toBe(12);
    expect(s.titlesStubbed).toBe(6);
    expect(s.rewatches).toBe(6);
    expect(s.reviewCount).toBe(4);
    expect(s.mostStubbed).toMatchObject({ count: 4 });
    expect(s.mostStubbed!.title.key).toBe(OFFICE);
    expect((await profiles.stats(LEO, 2026)).mostStubbed).toBeNull();
  });

  it('updates only whitelisted fields, looks up handles case-insensitively', async () => {
    const p = await profiles.update(LEO, {
      displayName: 'Leo B',
      bio: 'hi',
      avatarUrl: 'https://x.test/a.png',
    });
    expect(p).toMatchObject({
      handle: 'leo',
      displayName: 'Leo B',
      bio: 'hi',
      avatarUrl: 'https://x.test/a.png',
    });
    expect((await profiles.getByHandle('LEO'))!.displayName).toBe('Leo B');
    expect(await profiles.getByHandle('nobody')).toBeNull();
    expect(await code(profiles.update('00000000-0000-4000-8000-00000000dead', { bio: 'x' }))).toBe(
      'not_found',
    );
  });
});
