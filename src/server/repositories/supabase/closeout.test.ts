/** ADR-013 live repositories with a mocked supabase-js fetch: exact RPC/PostgREST requests + mapping. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseCatalogIndex,
  SupabaseEvents,
  SupabaseImports,
  SupabaseProfiles,
  SupabaseStubs,
  SupabaseWatchProviders,
  resetWatchMemo,
} from './index';
import { mapPgError, rowToReview, rowToStub, type ReviewRow } from './rows';

interface Call {
  method: string;
  url: URL;
  body: unknown;
}

function fake(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const raw = init?.body;
    const call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(handler(call) ?? null), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client: SupabaseClient = createClient('https://proj.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  });
  return {
    calls,
    client,
    clients: { user: () => client, public: () => client, catalog: () => client },
  };
}
const path = (c: Call) => c.url.pathname.replace('/rest/v1', '');

const catRow = (key: string, watch: unknown = null) => ({
  title_key: key,
  media_type: key.split(':')[0],
  tmdb_id: Number(key.split(':')[1]),
  imdb_id: null,
  title: 'T',
  original_title: 'T',
  slug: 't',
  overview_short: '',
  release_date: '2020-01-01',
  vote_average: 7,
  vote_count: 500,
  imdb_rating: null,
  imdb_votes: null,
  popularity: 1,
  genres: [],
  poster_path: null,
  backdrop_path: null,
  palette: null,
  runtime_minutes: null,
  season_count: null,
  episode_count: null,
  episode_runtime: null,
  is_listed: true,
  watch,
  watch_checked_at: '2026-10-01T00:00:00Z',
});

describe('catalogue (C-01/C-02/C-11)', () => {
  it('sends p_watch_tag only with provider + region; list rows feed storedWatch without a round trip', async () => {
    resetWatchMemo();
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/catalog_count' ? 1 : [catRow('movie:1', { US: { s: [8] } })],
    );
    const repo = new SupabaseCatalogIndex(clients);
    await repo.list({ type: 'all', sort: 'release_desc', limit: 20, region: 'US', provider: 8 });
    const page = calls.find((c) => path(c) === '/rpc/catalog_page')!;
    const count = calls.find((c) => path(c) === '/rpc/catalog_count')!;
    expect(page.url.searchParams.get('p_watch_tag')).toBe('US:8');
    expect(count.url.searchParams.get('p_watch_tag')).toBe('US:8');
    calls.length = 0;
    const w = await repo.storedWatch(['movie:1']);
    expect(calls).toHaveLength(0);
    expect(w.get('movie:1')).toEqual({
      store: { US: { s: [8] } },
      checkedAt: '2026-10-01T00:00:00Z',
    });
    await repo.list({ type: 'all', sort: 'release_desc', limit: 20, region: 'US' });
    expect(
      calls.find((c) => path(c) === '/rpc/catalog_page')!.url.searchParams.has('p_watch_tag'),
    ).toBe(false);
    calls.length = 0;
    await repo.storedWatch(['tv:2']);
    expect(path(calls[0]!)).toBe('/catalog_index');
    expect(calls[0]!.url.searchParams.get('select')).toBe('title_key,watch,watch_checked_at');
  });

  it('match → rpc catalog_match with snake_case items', async () => {
    const { calls, clients } = fake(() => [{ ref: 'a', title: catRow('movie:278') }]);
    const out = await new SupabaseCatalogIndex(clients).match([
      { ref: 'a', mediaType: 'movie', tmdbId: 278 },
      { ref: 'b', titleNorm: 'x', year: 2000 },
    ]);
    expect(out.get('a')!.key).toBe('movie:278');
    expect(path(calls[0]!)).toBe('/rpc/catalog_match');
    expect(calls[0]!.body).toEqual({
      p_items: [
        {
          ref: 'a',
          media_type: 'movie',
          tmdb_id: 278,
          imdb_id: null,
          title_norm: null,
          year: null,
        },
        { ref: 'b', media_type: null, tmdb_id: null, imdb_id: null, title_norm: 'x', year: 2000 },
      ],
    });
  });

  it('chips → rpc watch_provider_counts (count >= 1, <= 6)', async () => {
    const { calls, client } = fake(() => [
      { provider_id: 8, name: 'Netflix', logo_path: '/n.png', priority: 1, count: 3 },
      { provider_id: 9, name: 'Zero', logo_path: null, priority: 2, count: 0 },
    ]);
    const chips = await new SupabaseWatchProviders(() => client).chips('US');
    expect(chips).toEqual([
      {
        providerId: 8,
        name: 'Netflix',
        logoPath: '/n.png',
        monogram: expect.any(String),
        count: 3,
      },
    ]);
    expect(calls[0]!.url.searchParams.get('p_region')).toBe('US');
  });
});

describe('stubs + profiles (C-10/C-12/C-08)', () => {
  it('stub_insert gets p_season only when set; PATCH maps season_number; getById is public', async () => {
    const stubRow = {
      id: '0a000000-0000-4000-8000-0000000000a1',
      user_id: 'u1',
      title_key: 'tv:1',
      watched_on: '2024-01-01',
      watched_where: null,
      note: '',
      created_at: 'c',
      updated_at: 'u',
      number: 1,
      season: 2,
    };
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/stub_insert'
        ? [stubRow]
        : path(c) === '/stubs'
          ? [{ id: stubRow.id }]
          : stubRow,
    );
    const repo = new SupabaseStubs(clients);
    const s = await repo.create({
      userId: 'u1',
      titleKey: 'tv:1',
      watchedOn: '2024-01-01',
      watchedWhere: null,
      note: '',
      season: 2,
    });
    expect(s.season).toBe(2);
    expect(calls[0]!.body).toMatchObject({ p_season: 2 });
    calls.length = 0;
    await repo.create({
      userId: 'u1',
      titleKey: 'movie:1',
      watchedOn: '2024-01-01',
      watchedWhere: null,
      note: '',
    });
    expect(calls[0]!.body).not.toHaveProperty('p_season');
    calls.length = 0;
    await repo.update('u1', stubRow.id, { season: null });
    expect(calls[0]!.body).toEqual({ season_number: null });
    expect((await repo.getById(stubRow.id))?.userId).toBe('u1');
    expect(await repo.getById('nope')).toBeNull();
    expect(rowToStub({ ...stubRow, season: undefined }, 'u1').season).toBeNull();
  });

  it('profiles select + update avatar_color; review authors map avatarColor', async () => {
    const { calls, clients } = fake(() => ({
      id: 'u1',
      handle: 'maya',
      display_name: 'Maya',
      bio: '',
      avatar_url: null,
      created_at: 'c',
      avatar_color: 'gold',
    }));
    const p = await new SupabaseProfiles(clients).update('u1', { avatarColor: 'gold' });
    expect(p.avatarColor).toBe('gold');
    expect(calls[0]!.body).toEqual({ avatar_color: 'gold' });
    expect(calls[0]!.url.searchParams.get('select')).toContain('avatar_color');
    const author = {
      id: 'u',
      handle: 'h',
      displayName: 'H',
      bio: '',
      avatarUrl: null,
      createdAt: 'c',
    };
    const r = { author: { ...author, avatarColor: 'bogus' } } as unknown as ReviewRow;
    expect(rowToReview(r).author.avatarColor).toBeNull();
    expect(mapPgError({ code: '22023', message: 'season_on_movie' }).fields).toEqual({
      season: expect.any(String),
    });
  });
});

describe('events + imports (C-09/C-11)', () => {
  it('events_track via the service role; without one the counters are dropped once with a warning', async () => {
    const { calls, client } = fake(() => 1);
    await new SupabaseEvents(() => client).track([{ name: 'stub_created', dim: '', n: 2 }]);
    expect(path(calls[0]!)).toBe('/rpc/events_track');
    expect(calls[0]!.body).toEqual({ p_rows: [{ name: 'stub_created', dim: '', n: 2 }] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const none = new SupabaseEvents(null);
    await none.track([{ name: 'stub_created', dim: '', n: 1 }]);
    await none.track([{ name: 'stub_created', dim: '', n: 1 }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('import_apply rows + existing lookups', async () => {
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/import_apply'
        ? { stubs: 1, reviews: 0 }
        : path(c) === '/stub_details'
          ? [{ title_key: 'movie:1', watched_on: '2024-01-01' }]
          : [{ title_key: 'movie:1' }],
    );
    const repo = new SupabaseImports(clients);
    const ex = await repo.existing('u1', ['movie:1']);
    expect([...ex.stubDays]).toEqual(['movie:1|2024-01-01']);
    expect([...ex.reviewed]).toEqual(['movie:1']);
    calls.length = 0;
    const out = await repo.apply('u1', 'imdb', [
      {
        titleKey: 'movie:1',
        importKey: 'a'.repeat(64),
        watchedOn: '2024-01-02',
        season: null,
        rating10: null,
        body: '',
        isSpoiler: false,
      },
    ]);
    expect(out).toEqual({ stubs: 1, reviews: 0 });
    expect(calls[0]!.body).toEqual({
      p_source: 'imdb',
      p_rows: [
        {
          title_key: 'movie:1',
          import_key: 'a'.repeat(64),
          watched_on: '2024-01-02',
          season: null,
          rating_10: null,
          body: '',
          is_spoiler: false,
        },
      ],
    });
  });
});
