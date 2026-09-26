/**
 * Live-mode repositories over Supabase (PostgREST + RPC). OWNER: Backend.
 *
 * - Public reads (catalogue, profiles, diaries, reviews, stats) use cookie-less anon clients, so pages
 *   that call them never depend on the session. The catalogue client is data-cached (tag `catalog`).
 * - Writes and private reads use the request client (user JWT) → RLS + triggers apply: ownership,
 *   stub/review validation and the 30/10-per-minute rate limits are enforced by Postgres.
 * - Ordering/cursors: the catalogue uses `catalog_page()` + the frozen cursor of src/lib/catalog-order.ts;
 *   user lists use the SQL functions of migrations/20260926120000_user_data_reads.sql + src/server/cursor.ts,
 *   with `limit + 1` to detect the next page. Every list is a constant number of round trips (no N+1).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeCursor, encodeCursor, sortTuple } from '@/lib/catalog-order';
import { AppError } from '@/lib/errors';
import { parseTitleKey, toTitleKey } from '@/lib/keys';
import type {
  CatalogQuery,
  DiaryEntry,
  MediaType,
  Page,
  ProfileStats,
  PublicProfile,
  Review,
  ReviewSort,
  ReviewWithTitle,
  Stub,
  TitleEnrichment,
  TitleKey,
  TitleState,
  TitleStats,
  TitleSummary,
  TypeFilter,
  WalletItem,
  WatchedWhere,
} from '@/lib/types';
import { decodeKeyset, encodeKeyset } from '@/server/cursor';
import type {
  CatalogIndexRepository,
  ProfileRepository,
  ReviewRepository,
  StubRepository,
  TitleStateRepository,
  WatchlistRepository,
} from '@/server/ports';
import type { RateDecision, RateLimiter } from '@/server/rate-limit';
import { averageOrNull, emptyTitleState } from '@/server/stats';
import {
  mapPgError,
  rowToEnrichment,
  rowToProfile,
  rowToReview,
  rowToStub,
  rowToSummary,
  unwrap,
  type CatalogRow,
  type ProfileRow,
  type ReviewRow,
  type StubRow,
} from './rows';

export type ClientFn = () => SupabaseClient | Promise<SupabaseClient>;

/** Lazily resolved default clients (so importing this module never needs env or a request). */
const defaults = {
  user: async () => (await import('@/server/supabase/server')).supabaseForRequest(),
  public: async () => (await import('@/server/supabase/server')).supabasePublic(),
  catalog: async () => (await import('@/server/supabase/server')).supabaseCatalog(),
};

export interface Clients {
  user: ClientFn;
  public: ClientFn;
  catalog: ClientFn;
}

const resolveClients = (c?: Partial<Clients>): Clients => ({ ...defaults, ...c });

/** Quote a value for a PostgREST logic-tree filter (`or=(…)`). */
const q = (v: string | number) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;

/* Keyset tuples arrive in client-supplied cursors. A tampered value must restart at page 1 (ADR-003),
   never reach a SQL cast (`::date`, `::uuid`, `::int`…) and surface as a 500. */
type Col = 'date' | 'ts' | 'uuid' | 'int' | 'num' | 'str';
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (v: string) => {
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.slice(0, 10);
};
const COL_OK: Record<Col, (v: unknown) => boolean> = {
  date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && validDate(v),
  ts: (v) => typeof v === 'string' && TS_RE.test(v) && validDate(v) && !Number.isNaN(Date.parse(v)),
  uuid: (v) => typeof v === 'string' && UUID_RE.test(v),
  int: (v) => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 2_147_483_647,
  num: (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e9,
  str: (v) => typeof v === 'string' && v.length <= 300,
};

/** The tuple when every position has the SQL type the keyset expects, else null (→ page 1). */
export function typedTuple<T extends readonly unknown[]>(
  tuple: T | null | undefined,
  cols: readonly Col[],
): T | null {
  return tuple && tuple.length === cols.length && cols.every((c, i) => COL_OK[c](tuple[i]))
    ? tuple
    : null;
}

const CATALOG_COLS: Record<CatalogQuery['sort'], readonly Col[]> = {
  release_desc: ['date', 'str', 'str'],
  release_asc: ['date', 'str', 'str'],
  rating_desc: ['num', 'int', 'str', 'str'],
  rating_asc: ['num', 'int', 'str', 'str'],
  popularity_desc: ['num', 'str'],
};

function nextPage<T, R>(
  rows: R[],
  limit: number,
  map: (r: R) => T,
  cursorOf: (last: R) => string,
): Page<T> {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: rows.length > limit && last ? cursorOf(last) : null,
  };
}

async function titleIdOf(db: SupabaseClient, key: TitleKey): Promise<number> {
  const res = await db.from('catalog_index').select('id').eq('title_key', key).maybeSingle();
  const row = unwrap(res) as { id: number } | null;
  if (!row) throw new AppError('not_found', "This ticket doesn't exist.");
  return Number(row.id);
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export class SupabaseCatalogIndex implements CatalogIndexRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  private async db() {
    return this.clients.catalog();
  }

  async list(query: CatalogQuery): Promise<Page<TitleSummary>> {
    const db = await this.db();
    const limit = query.limit ?? 20;
    const after = typedTuple(decodeCursor(query.cursor, query.sort), CATALOG_COLS[query.sort]);
    const genres = query.genreIds?.length ? query.genreIds : undefined;
    // GET (+ data cache): jsonb/array args must be pre-encoded; absent args fall back to SQL defaults.
    const [page, count] = await Promise.all([
      db.rpc(
        'catalog_page',
        {
          p_type: query.type,
          p_sort: query.sort,
          p_limit: limit + 1,
          ...(after ? { p_after: JSON.stringify(after) } : {}),
          ...(genres ? { p_genre_ids: genres } : {}),
        },
        { get: true },
      ),
      db.rpc(
        'catalog_count',
        { p_type: query.type, ...(genres ? { p_genre_ids: genres } : {}) },
        { get: true },
      ),
    ]);
    const rows = (unwrap(page) as CatalogRow[] | null) ?? [];
    const total = Number(unwrap(count) ?? 0);
    const result = nextPage(rows, limit, rowToSummary, (last) =>
      encodeCursor(query.sort, sortTuple(rowToSummary(last), query.sort)),
    );
    return { ...result, total };
  }

  async trending(type: TypeFilter, limit: number): Promise<TitleSummary[]> {
    const db = await this.db();
    const res = await db.rpc(
      'catalog_page',
      { p_type: type, p_sort: 'popularity_desc', p_limit: limit },
      { get: true },
    );
    return ((unwrap(res) as CatalogRow[] | null) ?? []).map(rowToSummary);
  }

  async search(normalizedQuery: string, type: TypeFilter, limit: number): Promise<TitleSummary[]> {
    if (!normalizedQuery) return [];
    const db = await this.db();
    const res = await db.rpc(
      'catalog_search',
      { p_q: normalizedQuery, p_type: type, p_limit: limit },
      { get: true },
    );
    return ((unwrap(res) as CatalogRow[] | null) ?? []).map(rowToSummary);
  }

  private async row(mediaType: MediaType, tmdbId: number): Promise<CatalogRow | null> {
    const db = await this.db();
    const res = await db
      .from('catalog_index')
      .select('*')
      .eq('title_key', toTitleKey(mediaType, tmdbId))
      .maybeSingle();
    return unwrap(res) as CatalogRow | null;
  }

  async get(mediaType: MediaType, tmdbId: number): Promise<TitleSummary | null> {
    const r = await this.row(mediaType, tmdbId);
    return r ? rowToSummary(r) : null;
  }

  async getEntry(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<{ summary: TitleSummary; enrichment: TitleEnrichment } | null> {
    const r = await this.row(mediaType, tmdbId);
    return r ? { summary: rowToSummary(r), enrichment: rowToEnrichment(r) } : null;
  }

  async getMany(keys: TitleKey[]): Promise<Map<TitleKey, TitleSummary>> {
    const out = new Map<TitleKey, TitleSummary>();
    const unique = [...new Set(keys)].slice(0, 200);
    if (unique.length === 0) return out;
    const db = await this.db();
    const res = await db.from('catalog_index').select('*').in('title_key', unique);
    for (const r of (unwrap(res) as CatalogRow[] | null) ?? []) {
      const s = rowToSummary(r);
      out.set(s.key, s);
    }
    return out;
  }

  async count(): Promise<number> {
    const db = await this.db();
    return Number(unwrap(await db.rpc('catalog_count', { p_type: 'all' }, { get: true })) ?? 0);
  }

  async lastSyncAt(): Promise<string | null> {
    const db = await this.db();
    return (unwrap(await db.rpc('last_catalog_sync', {}, { get: true })) as string | null) ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

const PROFILE_COLUMNS = 'id, handle, display_name, bio, avatar_url, created_at';

interface ProfileStatsRow {
  total_stubs: number;
  stubs_this_year: number;
  titles_stubbed: number;
  review_count: number;
  most_stubbed: { count: number; title: CatalogRow } | null;
}

export class SupabaseProfiles implements ProfileRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  async getByHandle(handle: string): Promise<PublicProfile | null> {
    const h = handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return null;
    const db = await this.clients.public();
    const res = await db.from('profiles').select(PROFILE_COLUMNS).eq('handle', h).maybeSingle();
    const row = unwrap(res) as ProfileRow | null;
    return row ? rowToProfile(row) : null;
  }

  async getById(id: string): Promise<PublicProfile | null> {
    const db = await this.clients.public();
    const res = await db.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle();
    const row = unwrap(res) as ProfileRow | null;
    return row ? rowToProfile(row) : null;
  }

  async stats(userId: string, year: number): Promise<ProfileStats> {
    const db = await this.clients.public();
    const s = unwrap(
      await db.rpc('profile_stats', { p_user: userId, p_year: year }),
    ) as ProfileStatsRow;
    const total = Number(s.total_stubs) || 0;
    const titles = Number(s.titles_stubbed) || 0;
    return {
      totalStubs: total,
      stubsThisYear: Number(s.stubs_this_year) || 0,
      rewatches: Math.max(0, total - titles),
      titlesStubbed: titles,
      reviewCount: Number(s.review_count) || 0,
      mostStubbed: s.most_stubbed
        ? { title: rowToSummary(s.most_stubbed.title), count: Number(s.most_stubbed.count) }
        : null,
    };
  }

  async update(
    userId: string,
    patch: { displayName?: string; bio?: string; avatarUrl?: string | null },
  ): Promise<PublicProfile> {
    const db = await this.clients.user();
    const res = await db
      .from('profiles')
      .update({
        ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
      })
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    const row = unwrap(res) as ProfileRow | null;
    if (!row) throw new AppError('not_found', 'Profile not found.');
    return rowToProfile(row);
  }
}

/* ------------------------------------------------------------------ */
/* Stubs                                                               */
/* ------------------------------------------------------------------ */

type DiaryRow = StubRow & { title: CatalogRow };
type WalletRow = {
  title_key: string;
  count: number;
  last_watched_on: string;
  last_created_at: string;
  title: CatalogRow;
};

export class SupabaseStubs implements StubRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  async create(input: {
    userId: string;
    titleKey: TitleKey;
    watchedOn: string;
    watchedWhere: WatchedWhere | null;
    note: string;
  }): Promise<Stub> {
    const db = await this.clients.user();
    const res = await db.rpc('stub_insert', {
      p_title_key: input.titleKey,
      p_watched_on: input.watchedOn,
      p_watched_where: input.watchedWhere,
      p_note: input.note,
    });
    const rows = unwrap(res, 'stub') as StubRow[] | null;
    const row = rows?.[0];
    if (!row) throw new AppError('internal', 'Something went wrong. Try again.');
    return rowToStub(row, input.userId);
  }

  async get(userId: string, id: string): Promise<Stub | null> {
    const db = await this.clients.user();
    const res = await db
      .from('stub_details')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    const row = unwrap(res) as StubRow | null;
    return row ? rowToStub(row, userId) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: { watchedOn?: string; watchedWhere?: WatchedWhere | null; note?: string },
  ): Promise<Stub> {
    const db = await this.clients.user();
    const res = await db
      .from('stubs')
      .update({
        ...(patch.watchedOn !== undefined ? { watched_on: patch.watchedOn } : {}),
        ...(patch.watchedWhere !== undefined ? { watched_where: patch.watchedWhere } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');
    const rows = unwrap(res, 'stub') as { id: string }[] | null;
    if (!rows?.length) throw new AppError('not_found', "This stub doesn't exist.");
    const stub = await this.get(userId, id);
    if (!stub) throw new AppError('not_found', "This stub doesn't exist.");
    return stub;
  }

  async delete(userId: string, id: string): Promise<Stub> {
    const before = await this.get(userId, id);
    if (!before) throw new AppError('not_found', "This stub doesn't exist.");
    const db = await this.clients.user();
    const res = await db.from('stubs').delete().eq('id', id).eq('user_id', userId).select('id');
    const rows = unwrap(res, 'stub') as { id: string }[] | null;
    if (!rows?.length) throw new AppError('not_found', "This stub doesn't exist.");
    return before;
  }

  async diary(
    userId: string,
    opts: { type: TypeFilter; cursor?: string | null; limit: number },
  ): Promise<Page<DiaryEntry> & { total: number }> {
    const db = await this.clients.public();
    const after = typedTuple(decodeKeyset(opts.cursor, 'diary', 3), ['date', 'ts', 'uuid']);
    const [res, total] = await Promise.all([
      db.rpc('user_diary', {
        p_user: userId,
        p_type: opts.type,
        p_after: after,
        p_limit: opts.limit + 1,
      }),
      this.count(userId, opts.type),
    ]);
    const rows = (unwrap(res) as DiaryRow[] | null) ?? [];
    const page = nextPage(
      rows,
      opts.limit,
      (r) => ({ ...rowToStub(r, userId), title: rowToSummary(r.title) }),
      (r) => encodeKeyset('diary', [String(r.watched_on).slice(0, 10), r.created_at, r.id]),
    );
    return { ...page, total };
  }

  async count(userId: string, type: TypeFilter = 'all'): Promise<number> {
    const db = await this.clients.public();
    const res = await db.rpc('user_diary_count', { p_user: userId, p_type: type });
    return Number(unwrap(res) ?? 0);
  }

  async wallet(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<WalletItem>> {
    const db = await this.clients.public();
    const after = typedTuple(decodeKeyset(opts.cursor, 'wallet', 3), ['date', 'ts', 'str']);
    const res = await db.rpc('user_wallet', {
      p_user: userId,
      p_after: after,
      p_limit: opts.limit + 1,
    });
    const rows = (unwrap(res) as WalletRow[] | null) ?? [];
    return nextPage(
      rows,
      opts.limit,
      (r) => ({
        title: rowToSummary(r.title),
        count: Number(r.count),
        lastWatchedOn: String(r.last_watched_on).slice(0, 10),
      }),
      (r) =>
        encodeKeyset('wallet', [
          String(r.last_watched_on).slice(0, 10),
          r.last_created_at,
          r.title_key,
        ]),
    );
  }

  async countRecent(userId: string, sinceIso: string): Promise<number> {
    const db = await this.clients.user();
    const res = await db
      .from('stubs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('created_at', sinceIso);
    if (res.error) throw mapPgError(res.error);
    return res.count ?? 0;
  }
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

async function reviewsByIds(db: SupabaseClient, ids: string[]): Promise<Map<string, Review>> {
  const out = new Map<string, Review>();
  if (ids.length === 0) return out;
  const res = await db.from('review_details').select('*').in('id', ids);
  for (const r of (unwrap(res) as ReviewRow[] | null) ?? []) out.set(r.id, rowToReview(r));
  return out;
}

export class SupabaseReviews implements ReviewRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  async upsert(input: {
    userId: string;
    titleKey: TitleKey;
    rating10: number;
    body: string;
    isSpoiler: boolean;
    stubId: string | null;
  }): Promise<{ review: Review; created: boolean }> {
    const db = await this.clients.user();
    const titleId = await titleIdOf(db, input.titleKey);
    const values = {
      rating_10: input.rating10,
      body: input.body,
      is_spoiler: input.isSpoiler,
      stub_id: input.stubId,
    };
    const update = async () => {
      const res = await db
        .from('reviews')
        .update(values)
        .eq('user_id', input.userId)
        .eq('title_id', titleId)
        .select('id');
      const rows = unwrap(res, 'review') as { id: string }[] | null;
      return rows?.[0]?.id ?? null;
    };
    // One review per (user, title): update first; insert when there is none; a concurrent insert
    // (unique violation) falls back to the update.
    let id = await update();
    let created = false;
    if (!id) {
      const ins = await db
        .from('reviews')
        .insert({ user_id: input.userId, title_id: titleId, ...values })
        .select('id')
        .single();
      if (ins.error?.code === '23505') id = await update();
      else {
        id = (unwrap(ins, 'review') as { id: string }).id;
        created = true;
      }
    }
    const review = id ? (await reviewsByIds(db, [id])).get(id) : undefined;
    if (!review) throw new AppError('internal', 'Something went wrong. Try again.');
    return { review, created };
  }

  async delete(userId: string, id: string): Promise<void> {
    const db = await this.clients.user();
    const res = await db.from('reviews').delete().eq('id', id).eq('user_id', userId).select('id');
    const rows = unwrap(res, 'review') as { id: string }[] | null;
    if (!rows?.length) throw new AppError('not_found', "This review doesn't exist.");
  }

  async listForTitle(
    titleKey: TitleKey,
    opts: { sort: ReviewSort; cursor?: string | null; limit: number },
  ): Promise<Page<Review>> {
    const db = await this.clients.public();
    const highest = opts.sort === 'highest';
    const kind = highest ? 'reviews:highest' : 'reviews:newest';
    const after = typedTuple(
      decodeKeyset(opts.cursor, kind, highest ? 3 : 2),
      highest ? ['int', 'ts', 'uuid'] : ['ts', 'uuid'],
    );
    const res = await db.rpc('title_reviews', {
      p_title_key: titleKey,
      p_sort: opts.sort,
      p_after: after,
      p_limit: opts.limit + 1,
    });
    const rows = (unwrap(res) as ReviewRow[] | null) ?? [];
    return nextPage(rows, opts.limit, rowToReview, (r) =>
      encodeKeyset(
        kind,
        highest ? [Number(r.rating_10), r.created_at, r.id] : [r.created_at, r.id],
      ),
    );
  }

  async listForUser(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<ReviewWithTitle>> {
    const db = await this.clients.public();
    const after = typedTuple(decodeKeyset(opts.cursor, 'user-reviews', 2), ['ts', 'uuid']);
    const res = await db.rpc('user_reviews', {
      p_user: userId,
      p_after: after,
      p_limit: opts.limit + 1,
    });
    const rows = (unwrap(res) as { review: ReviewRow; title: CatalogRow }[] | null) ?? [];
    return nextPage(
      rows,
      opts.limit,
      (r) => ({ ...rowToReview(r.review), title: rowToSummary(r.title) }),
      (r) => encodeKeyset('user-reviews', [r.review.created_at, r.review.id]),
    );
  }

  async countRecent(userId: string, sinceIso: string): Promise<number> {
    const db = await this.clients.user();
    const res = await db
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('updated_at', sinceIso);
    if (res.error) throw mapPgError(res.error);
    return res.count ?? 0;
  }
}

/* ------------------------------------------------------------------ */
/* Watchlist                                                           */
/* ------------------------------------------------------------------ */

export class SupabaseWatchlist implements WatchlistRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  async add(userId: string, titleKey: TitleKey): Promise<void> {
    const db = await this.clients.user();
    const titleId = await titleIdOf(db, titleKey);
    const res = await db.from('watchlist').upsert(
      { user_id: userId, title_id: titleId },
      {
        onConflict: 'user_id,title_id',
        ignoreDuplicates: true,
      },
    );
    if (res.error) throw mapPgError(res.error);
  }

  async remove(userId: string, titleKey: TitleKey): Promise<void> {
    const db = await this.clients.user();
    const ref = parseTitleKey(titleKey);
    if (!ref) return;
    const found = unwrap(
      await db.from('catalog_index').select('id').eq('title_key', titleKey).maybeSingle(),
    ) as { id: number } | null;
    if (!found) return; // idempotent
    const res = await db.from('watchlist').delete().eq('user_id', userId).eq('title_id', found.id);
    if (res.error) throw mapPgError(res.error);
  }

  async list(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<TitleSummary>> {
    const db = await this.clients.user();
    const after = typedTuple(decodeKeyset(opts.cursor, 'watchlist', 2), ['ts', 'int']);
    let query = db
      .from('watchlist')
      .select('added_at, title_id, title:catalog_index(*)')
      .eq('user_id', userId);
    if (after)
      query = query.or(
        `added_at.lt.${q(after[0]!)},and(added_at.eq.${q(after[0]!)},title_id.gt.${Number(after[1])})`,
      );
    const res = await query
      .order('added_at', { ascending: false })
      .order('title_id', { ascending: true })
      .limit(opts.limit + 1);
    const rows =
      (unwrap(res) as unknown as
        { added_at: string; title_id: number; title: CatalogRow | null }[] | null) ?? [];
    const page = nextPage(
      rows,
      opts.limit,
      (r) => r,
      (r) => encodeKeyset('watchlist', [r.added_at, Number(r.title_id)]),
    );
    return {
      items: page.items.flatMap((r) => (r.title ? [rowToSummary(r.title)] : [])),
      nextCursor: page.nextCursor,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Title states + stats                                                */
/* ------------------------------------------------------------------ */

interface StateRow {
  title_key: string;
  stub_count: number;
  last_watched_on: string | null;
  has_stub_today: boolean;
  watchlisted: boolean;
  review_id: string | null;
}

export class SupabaseTitleStates implements TitleStateRepository {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  /** Two round trips for up to 60 keys: states, then the user's reviews among them. */
  async states(
    userId: string,
    keys: TitleKey[],
    today: string,
  ): Promise<Record<TitleKey, TitleState>> {
    const out: Record<TitleKey, TitleState> = {};
    const unique = [...new Set(keys)].slice(0, 60);
    for (const k of unique) out[k] = emptyTitleState();
    if (unique.length === 0) return out;
    const db = await this.clients.user();
    const rows =
      (unwrap(
        await db.rpc('user_title_states', { p_user: userId, p_keys: unique, p_today: today }),
      ) as StateRow[] | null) ?? [];
    const reviewIds = rows.map((r) => r.review_id).filter((x): x is string => Boolean(x));
    const reviews = await reviewsByIds(db, reviewIds);
    for (const r of rows) {
      out[r.title_key as TitleKey] = {
        stubCount: Number(r.stub_count) || 0,
        lastWatchedOn: r.last_watched_on ? String(r.last_watched_on).slice(0, 10) : null,
        hasStubToday: Boolean(r.has_stub_today),
        watchlisted: Boolean(r.watchlisted),
        myReview: r.review_id ? (reviews.get(r.review_id) ?? null) : null,
      };
    }
    return out;
  }

  async stats(titleKey: TitleKey): Promise<TitleStats> {
    const db = await this.clients.public();
    const rows =
      (unwrap(await db.rpc('title_stats_by_key', { p_title_key: titleKey })) as
        | { stub_count: number; review_count: number; rating_sum: number; rating_count: number }[]
        | null) ?? [];
    const s = rows[0];
    const count = Number(s?.rating_count ?? 0);
    return {
      stubCount: Number(s?.stub_count ?? 0),
      reviewCount: Number(s?.review_count ?? 0),
      ratingCount: count,
      ratingAvg10: averageOrNull(Number(s?.rating_sum ?? 0), count),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Rate limiter (export …) backed by public.consume_rate_limit()        */
/* ------------------------------------------------------------------ */

export class SupabaseRateLimiter implements RateLimiter {
  private readonly clients: Clients;
  constructor(clients?: Partial<Clients>) {
    this.clients = resolveClients(clients);
  }

  /** `key` = "{kind}:{userId}"; the DB derives the user from the JWT, so only the kind is sent. */
  async consume(key: string, max: number, windowSec: number): Promise<RateDecision> {
    const kind = key.split(':')[0] ?? key;
    const db = await this.clients.user();
    const wait = Number(
      unwrap(
        await db.rpc('consume_rate_limit', { p_kind: kind, p_max: max, p_window_secs: windowSec }),
      ),
    );
    return wait > 0 ? { ok: false, retryAfter: wait } : { ok: true };
  }
}
