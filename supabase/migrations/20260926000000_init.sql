-- =============================================================================
-- Stubbed — initial schema (ADR-002/003/004/005). OWNER: Architect.
-- Later changes: add NEW migration files (Backend); never edit an applied migration.
-- Verified offline by tests/db/migrations.test.ts (PGlite + a Supabase auth shim).
-- =============================================================================

create extension if not exists pg_trgm;
create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Catalogue index: the curated list (~10-15k rows). Written ONLY by the service role
-- (nightly sync job, lazy inserts from the server). Readable by everyone.
-- sort_title / search_text are computed by the app with src/lib/text.ts normalizeSearch()
-- so JS (demo mode) and SQL order/search identically.
-- -----------------------------------------------------------------------------
create table public.catalog_index (
  id               bigint generated always as identity primary key,
  media_type       text not null check (media_type in ('movie', 'tv')),
  tmdb_id          integer not null check (tmdb_id > 0),
  title_key        text collate "C" generated always as (media_type || ':' || tmdb_id::text) stored,
  imdb_id          text check (imdb_id is null or imdb_id ~ '^tt[0-9]{7,10}$'),
  title            text not null,
  original_title   text not null,
  slug             text not null,
  overview_short   text not null default '' check (char_length(overview_short) <= 300),
  release_date     date,
  vote_average     numeric(3,1) not null check (vote_average between 0 and 10),
  vote_count       integer not null check (vote_count >= 0),
  popularity       real not null default 0,
  genre_ids        integer[] not null default '{}',
  genres           jsonb not null default '[]'::jsonb,        -- [{id, name}] denormalised for display
  original_language text,
  poster_path      text,
  backdrop_path    text,
  palette          jsonb,                                      -- src/lib/types.ts Palette, null until computed
  needs_palette    boolean not null default true,
  runtime_minutes  smallint,
  season_count     smallint,
  sort_title       text collate "C" not null,
  search_text      text not null,
  is_listed        boolean not null default false,
  source_status    text not null default 'active' check (source_status in ('active', 'gone')),
  first_seen_at    timestamptz not null default now(),
  synced_at        timestamptz not null default now(),
  unique (media_type, tmdb_id),
  unique (title_key)
);

comment on table public.catalog_index is
  'Curated TMDB index (vote_average >= 6.5 + vote floors). is_listed=false rows stay reachable by URL (hysteresis, PRD D4).';

-- Keyset indexes: one per sort (src/lib/catalog-order.ts), for "all" and per media type. Partial on is_listed.
create index catalog_release_desc   on public.catalog_index (release_date desc, sort_title, title_key) where is_listed;
create index catalog_release_asc    on public.catalog_index (release_date asc, sort_title, title_key) where is_listed;
create index catalog_rating_desc    on public.catalog_index (vote_average desc, vote_count desc, sort_title, title_key) where is_listed;
create index catalog_rating_asc     on public.catalog_index (vote_average asc, vote_count desc, sort_title, title_key) where is_listed;
create index catalog_popularity     on public.catalog_index (popularity desc, title_key) where is_listed;
create index catalog_t_release_desc on public.catalog_index (media_type, release_date desc, sort_title, title_key) where is_listed;
create index catalog_t_release_asc  on public.catalog_index (media_type, release_date asc, sort_title, title_key) where is_listed;
create index catalog_t_rating_desc  on public.catalog_index (media_type, vote_average desc, vote_count desc, sort_title, title_key) where is_listed;
create index catalog_t_rating_asc   on public.catalog_index (media_type, vote_average asc, vote_count desc, sort_title, title_key) where is_listed;
create index catalog_t_popularity   on public.catalog_index (media_type, popularity desc, title_key) where is_listed;
create index catalog_search_trgm    on public.catalog_index using gin (search_text gin_trgm_ops);
create index catalog_genres         on public.catalog_index using gin (genre_ids);
create index catalog_needs_palette  on public.catalog_index (id) where needs_palette;

-- Staging table for the nightly sync (same shape, no identity/constraints beyond the key).
create unlogged table public.catalog_staging (
  run_id           uuid not null,
  media_type       text not null,
  tmdb_id          integer not null,
  imdb_id          text,
  title            text not null,
  original_title   text not null,
  slug             text not null,
  overview_short   text not null default '',
  release_date     date,
  vote_average     numeric(3,1) not null,
  vote_count       integer not null,
  popularity       real not null default 0,
  genre_ids        integer[] not null default '{}',
  genres           jsonb not null default '[]'::jsonb,
  original_language text,
  poster_path      text,
  backdrop_path    text,
  sort_title       text not null,
  search_text      text not null,
  is_listed        boolean not null,
  primary key (run_id, media_type, tmdb_id)
);

-- Heavy detail payload cache (L2, SYSTEM_DESIGN §4.3). Purged after 150 days (TMDB 6-month rule).
create table public.title_detail_cache (
  title_id    bigint primary key references public.catalog_index (id) on delete cascade,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  etag        text
);
create index title_detail_cache_fetched on public.title_detail_cache (fetched_at);

-- Optional IMDb badge via OMDb (P1), TTL 7 days.
create table public.rating_enrichment (
  title_id     bigint primary key references public.catalog_index (id) on delete cascade,
  provider     text not null default 'omdb',
  imdb_rating  numeric(3,1),
  imdb_votes   integer,
  fetched_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       citext not null unique check (handle::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 50),
  bio          text not null default '' check (char_length(bio) <= 160),
  avatar_url   text check (avatar_url is null or char_length(avatar_url) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.is_reserved_handle(h text)
returns boolean language sql immutable as $$
  select lower(h) = any (array['admin','api','about','auth','browse','me','u','title','search','settings',
                               'signin','signup','stubbed','support','help','null','undefined'])
$$;

-- Pre-signup availability check (callable by anon).
create or replace function public.handle_available(h text)
returns boolean language sql stable security definer set search_path = public as $$
  select h ~ '^[a-z0-9_]{3,20}$'
     and not public.is_reserved_handle(h)
     and not exists (select 1 from public.profiles p where p.handle = h::citext)
$$;

-- Create the profile row when Supabase Auth creates a user. The app passes
-- options.data = { handle, display_name } to auth.signUp(). OAuth users without a handle get user_xxxxxxxx.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_handle text := lower(coalesce(new.raw_user_meta_data ->> 'handle', ''));
  v_name   text := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(v_handle, ''), 'New stubber');
begin
  if v_handle = '' then
    v_handle := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  if v_handle !~ '^[a-z0-9_]{3,20}$' or public.is_reserved_handle(v_handle) then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;
  insert into public.profiles (id, handle, display_name) values (new.id, v_handle, left(v_name, 50));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Stubs (watch events, many per title — PRD D8), reviews (one per user per title — D9), watchlist
-- -----------------------------------------------------------------------------
create table public.stubs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  title_id        bigint not null references public.catalog_index (id) on delete restrict,
  watched_on      date not null,
  watched_where   text check (watched_where in ('cinema', 'streaming', 'tv', 'other')),
  note            text not null default '' check (char_length(note) <= 280),
  season_number   smallint,   -- v1 (episodes)
  episode_number  smallint,   -- v1
  source          text not null default 'app' check (source in ('app', 'import', 'trakt')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index stubs_diary       on public.stubs (user_id, watched_on desc, created_at desc);
create index stubs_user_title  on public.stubs (user_id, title_id);
create index stubs_rate        on public.stubs (user_id, created_at);
create index stubs_title       on public.stubs (title_id);

create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  title_id        bigint not null references public.catalog_index (id) on delete restrict,
  rating_10       smallint not null check (rating_10 between 1 and 10),
  body            text not null default '' check (char_length(body) <= 5000),
  is_spoiler      boolean not null default false,
  stub_id         uuid references public.stubs (id) on delete set null,
  imdb_shared_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  edited_at       timestamptz,
  unique (user_id, title_id)
);
create index reviews_title_newest  on public.reviews (title_id, created_at desc, id);
create index reviews_title_highest on public.reviews (title_id, rating_10 desc, created_at desc, id);
create index reviews_user          on public.reviews (user_id, created_at desc, id);
create index reviews_rate          on public.reviews (user_id, updated_at);

create table public.watchlist (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  title_id  bigint not null references public.catalog_index (id) on delete restrict,
  added_at  timestamptz not null default now(),
  primary key (user_id, title_id)
);
create index watchlist_user_added on public.watchlist (user_id, added_at desc);

-- Community aggregates (trigger-maintained). ratingAvg10 is shown only when rating_count >= 5.
create table public.title_stats (
  title_id      bigint primary key references public.catalog_index (id) on delete cascade,
  stub_count    integer not null default 0,
  review_count  integer not null default 0,
  rating_sum    integer not null default 0,
  rating_count  integer not null default 0
);

-- -----------------------------------------------------------------------------
-- Ops + v1 sync (outbox). Never readable by anon/authenticated.
-- -----------------------------------------------------------------------------
create table public.sync_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'catalog',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'aborted', 'failed')),
  counts       jsonb not null default '{}'::jsonb,
  error        text
);

create table public.sync_accounts (      -- v1: Trakt / TMDB tokens, encrypted at app level (AES-GCM)
  user_id            uuid not null references public.profiles (id) on delete cascade,
  provider           text not null check (provider in ('trakt', 'tmdb')),
  access_token_enc   text not null,
  refresh_token_enc  text,
  expires_at         timestamptz,
  scopes             text,
  connected_at       timestamptz not null default now(),
  primary key (user_id, provider)
);

create table public.sync_jobs (          -- v1: outbox drained by a worker
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  provider         text not null,
  entity           text not null check (entity in ('stub', 'review', 'rating')),
  entity_id        uuid not null,
  idempotency_key  text not null unique,
  status           text not null default 'pending' check (status in ('pending', 'done', 'failed', 'dead')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now()
);
create index sync_jobs_due on public.sync_jobs (next_attempt_at) where status = 'pending';

-- =============================================================================
-- Triggers: validation, rate limits (PRD E5), edited_at, aggregates
-- =============================================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Stub validation + rate limit (30/min/user). Error 'rate_limited' (P0001) → HTTP 429.
create or replace function public.stubs_before_write()
returns trigger language plpgsql as $$
declare
  v_release date;
  v_recent  integer;
begin
  if new.watched_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'watched_on_in_future' using errcode = '22023';
  end if;
  select release_date into v_release from public.catalog_index where id = new.title_id;
  if v_release is not null and new.watched_on < make_date(extract(year from v_release)::int - 1, 1, 1) then
    raise exception 'watched_on_before_release' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    select count(*) into v_recent from public.stubs
      where user_id = new.user_id and created_at > now() - interval '1 minute';
    if v_recent >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=60';
    end if;
  else
    new.updated_at := now();
    if new.user_id <> old.user_id or new.title_id <> old.title_id then
      raise exception 'immutable_columns' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create trigger stubs_before_write before insert or update on public.stubs
  for each row execute function public.stubs_before_write();

-- Review rate limit (10/min/user, inserts + edits), edited_at, stub ownership.
create or replace function public.reviews_before_write()
returns trigger language plpgsql as $$
declare
  v_recent integer;
begin
  select count(*) into v_recent from public.reviews
    where user_id = new.user_id and updated_at > now() - interval '1 minute'
      and (tg_op = 'INSERT' or id <> new.id);
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=60';
  end if;
  if new.stub_id is not null and not exists (
    select 1 from public.stubs s where s.id = new.stub_id and s.user_id = new.user_id and s.title_id = new.title_id
  ) then
    raise exception 'stub_mismatch' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.title_id <> old.title_id then
      raise exception 'immutable_columns' using errcode = '22023';
    end if;
    new.updated_at := now();
    if new.rating_10 <> old.rating_10 or new.body <> old.body or new.is_spoiler <> old.is_spoiler then
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger reviews_before_write before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- Aggregates. SECURITY DEFINER because title_stats is not writable by users.
create or replace function public.title_stats_apply(p_title bigint, d_stubs int, d_reviews int, d_sum int, d_count int)
returns void language sql security definer set search_path = public as $$
  insert into public.title_stats as t (title_id, stub_count, review_count, rating_sum, rating_count)
  values (p_title, greatest(d_stubs, 0), greatest(d_reviews, 0), greatest(d_sum, 0), greatest(d_count, 0))
  on conflict (title_id) do update set
    stub_count   = greatest(t.stub_count + d_stubs, 0),
    review_count = greatest(t.review_count + d_reviews, 0),
    rating_sum   = greatest(t.rating_sum + d_sum, 0),
    rating_count = greatest(t.rating_count + d_count, 0)
$$;

create or replace function public.stubs_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.title_stats_apply(new.title_id, 1, 0, 0, 0);
  elsif tg_op = 'DELETE' then perform public.title_stats_apply(old.title_id, -1, 0, 0, 0);
  end if;
  return null;
end $$;

create trigger stubs_after_write after insert or delete on public.stubs
  for each row execute function public.stubs_after_write();

create or replace function public.reviews_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.title_stats_apply(new.title_id, 0, 1, new.rating_10, 1);
  elsif tg_op = 'DELETE' then
    perform public.title_stats_apply(old.title_id, 0, -1, -old.rating_10, -1);
  elsif new.rating_10 <> old.rating_10 then
    perform public.title_stats_apply(new.title_id, 0, 0, new.rating_10 - old.rating_10, 0);
  end if;
  return null;
end $$;

create trigger reviews_after_write after insert or update or delete on public.reviews
  for each row execute function public.reviews_after_write();

-- =============================================================================
-- Catalogue read functions (called via supabase.rpc). SECURITY INVOKER: RLS applies.
-- Order + cursor semantics MUST match src/lib/catalog-order.ts exactly.
-- p_after = the decoded cursor tuple as a JSON array, or null for the first page.
-- =============================================================================
create or replace function public.catalog_page(
  p_type      text,
  p_sort      text,
  p_after     jsonb default null,
  p_limit     integer default 20,
  p_genre_ids integer[] default null
) returns setof public.catalog_index
language plpgsql stable security invoker set search_path = public as $$
declare
  v_order text;
  v_after text;
begin
  if p_type not in ('all', 'movie', 'tv') then raise exception 'invalid_type' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then raise exception 'invalid_limit' using errcode = '22023'; end if;

  case p_sort
    when 'release_desc' then
      v_order := 'c.release_date desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.release_date < ($1->>0)::date
        or (c.release_date = ($1->>0)::date and (c.sort_title > ($1->>1)
        or (c.sort_title = ($1->>1) and c.title_key > ($1->>2)))))$k$;
    when 'release_asc' then
      v_order := 'c.release_date asc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.release_date > ($1->>0)::date
        or (c.release_date = ($1->>0)::date and (c.sort_title > ($1->>1)
        or (c.sort_title = ($1->>1) and c.title_key > ($1->>2)))))$k$;
    when 'rating_desc' then
      v_order := 'c.vote_average desc, c.vote_count desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.vote_average < ($1->>0)::numeric
        or (c.vote_average = ($1->>0)::numeric and (c.vote_count < ($1->>1)::int
        or (c.vote_count = ($1->>1)::int and (c.sort_title > ($1->>2)
        or (c.sort_title = ($1->>2) and c.title_key > ($1->>3)))))))$k$;
    when 'rating_asc' then
      v_order := 'c.vote_average asc, c.vote_count desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.vote_average > ($1->>0)::numeric
        or (c.vote_average = ($1->>0)::numeric and (c.vote_count < ($1->>1)::int
        or (c.vote_count = ($1->>1)::int and (c.sort_title > ($1->>2)
        or (c.sort_title = ($1->>2) and c.title_key > ($1->>3)))))))$k$;
    when 'popularity_desc' then
      v_order := 'c.popularity desc, c.title_key asc';
      v_after := $k$(c.popularity < ($1->>0)::real
        or (c.popularity = ($1->>0)::real and c.title_key > ($1->>1)))$k$;
    else
      raise exception 'invalid_sort' using errcode = '22023';
  end case;

  return query execute format(
    'select c.* from public.catalog_index c
      where c.is_listed
        and ($2 = ''all'' or c.media_type = $2)
        and ($4::int[] is null or c.genre_ids && $4)
        and ($1 is null or %s)
      order by %s
      limit $3', v_after, v_order)
  using p_after, p_type, p_limit, p_genre_ids;
end $$;

create or replace function public.catalog_count(p_type text, p_genre_ids integer[] default null)
returns bigint language sql stable security invoker set search_path = public as $$
  select count(*) from public.catalog_index c
   where c.is_listed and (p_type = 'all' or c.media_type = p_type)
     and (p_genre_ids is null or c.genre_ids && p_genre_ids)
$$;

-- p_q must already be normalizeSearch()'d by the app (letters/digits/spaces only → no LIKE wildcards).
create or replace function public.catalog_search(p_q text, p_type text default 'all', p_limit integer default 20)
returns setof public.catalog_index language sql stable security invoker set search_path = public as $$
  select c.* from public.catalog_index c
   where c.is_listed
     and (p_type = 'all' or c.media_type = p_type)
     and length(p_q) > 0
     and c.search_text like '%' || p_q || '%'
   order by (c.search_text like p_q || '%') desc, similarity(c.search_text, p_q) desc, c.popularity desc, c.title_key
   limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.last_catalog_sync()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(finished_at) from public.sync_runs where kind = 'catalog' and status = 'ok'
$$;

-- Nightly sync: merge a staged run into the index in ONE transaction (service role only).
-- Rows previously listed but absent from the run become unlisted (they are never deleted here).
create or replace function public.catalog_apply_staging(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_upserted integer;
  v_unlisted integer;
begin
  insert into public.catalog_index as c (
    media_type, tmdb_id, imdb_id, title, original_title, slug, overview_short, release_date,
    vote_average, vote_count, popularity, genre_ids, genres, original_language, poster_path,
    backdrop_path, sort_title, search_text, is_listed, synced_at, needs_palette
  )
  select s.media_type, s.tmdb_id, s.imdb_id, s.title, s.original_title, s.slug, s.overview_short, s.release_date,
         s.vote_average, s.vote_count, s.popularity, s.genre_ids, s.genres, s.original_language, s.poster_path,
         s.backdrop_path, s.sort_title, s.search_text, s.is_listed, now(), true
    from public.catalog_staging s where s.run_id = p_run
  on conflict (media_type, tmdb_id) do update set
    imdb_id = coalesce(excluded.imdb_id, c.imdb_id),
    title = excluded.title, original_title = excluded.original_title, slug = excluded.slug,
    overview_short = excluded.overview_short, release_date = excluded.release_date,
    vote_average = excluded.vote_average, vote_count = excluded.vote_count, popularity = excluded.popularity,
    genre_ids = excluded.genre_ids, genres = excluded.genres, original_language = excluded.original_language,
    backdrop_path = excluded.backdrop_path, sort_title = excluded.sort_title, search_text = excluded.search_text,
    is_listed = excluded.is_listed, synced_at = now(), source_status = 'active',
    needs_palette = c.needs_palette or c.poster_path is distinct from excluded.poster_path,
    poster_path = excluded.poster_path;
  get diagnostics v_upserted = row_count;

  update public.catalog_index c set is_listed = false
   where c.is_listed
     and not exists (select 1 from public.catalog_staging s
                      where s.run_id = p_run and s.media_type = c.media_type and s.tmdb_id = c.tmdb_id);
  get diagnostics v_unlisted = row_count;

  delete from public.catalog_staging where run_id = p_run;
  return jsonb_build_object('upserted', v_upserted, 'unlisted', v_unlisted);
end $$;

-- Retention (TMDB: cache <= 6 months). Run by the nightly job.
create or replace function public.catalog_purge_stale()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_detail integer;
  v_rows integer;
begin
  delete from public.title_detail_cache where fetched_at < now() - interval '150 days';
  get diagnostics v_detail = row_count;
  delete from public.catalog_index c
   where not c.is_listed and c.synced_at < now() - interval '150 days'
     and not exists (select 1 from public.stubs s where s.title_id = c.id)
     and not exists (select 1 from public.reviews r where r.title_id = c.id)
     and not exists (select 1 from public.watchlist w where w.title_id = c.id);
  get diagnostics v_rows = row_count;
  return jsonb_build_object('detail_purged', v_detail, 'index_purged', v_rows);
end $$;

-- =============================================================================
-- Row Level Security (SYSTEM_DESIGN §8.1). Every table has RLS on. service_role bypasses RLS.
-- =============================================================================
alter table public.catalog_index      enable row level security;
alter table public.catalog_staging    enable row level security;
alter table public.title_detail_cache enable row level security;
alter table public.rating_enrichment  enable row level security;
alter table public.title_stats        enable row level security;
alter table public.profiles           enable row level security;
alter table public.stubs              enable row level security;
alter table public.reviews            enable row level security;
alter table public.watchlist          enable row level security;
alter table public.sync_runs          enable row level security;
alter table public.sync_accounts      enable row level security;
alter table public.sync_jobs          enable row level security;

-- Public catalogue data: read-only for everyone.
create policy catalog_read      on public.catalog_index      for select to anon, authenticated using (true);
create policy detail_read       on public.title_detail_cache for select to anon, authenticated using (true);
create policy enrichment_read   on public.rating_enrichment  for select to anon, authenticated using (true);
create policy stats_read        on public.title_stats        for select to anon, authenticated using (true);

-- Profiles: public read; users update their own row (handle is not updatable: column grants below).
create policy profiles_read     on public.profiles for select to anon, authenticated using (true);
create policy profiles_update   on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Stubs: public diaries (PRD B3); owner-only writes.
create policy stubs_read        on public.stubs for select to anon, authenticated using (true);
create policy stubs_insert      on public.stubs for insert to authenticated with check (user_id = (select auth.uid()));
create policy stubs_update      on public.stubs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy stubs_delete      on public.stubs for delete to authenticated using (user_id = (select auth.uid()));

-- Reviews: public read; owner-only writes.
create policy reviews_read      on public.reviews for select to anon, authenticated using (true);
create policy reviews_insert    on public.reviews for insert to authenticated with check (user_id = (select auth.uid()));
create policy reviews_update    on public.reviews for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reviews_delete    on public.reviews for delete to authenticated using (user_id = (select auth.uid()));

-- Watchlist: private to the owner.
create policy watchlist_read    on public.watchlist for select to authenticated using (user_id = (select auth.uid()));
create policy watchlist_insert  on public.watchlist for insert to authenticated with check (user_id = (select auth.uid()));
create policy watchlist_delete  on public.watchlist for delete to authenticated using (user_id = (select auth.uid()));

-- catalog_staging, sync_runs, sync_accounts, sync_jobs: no policies → no access except service_role.

-- Column-level privileges (defence in depth on top of RLS).
revoke update on public.profiles from anon, authenticated;
grant  update (display_name, bio, avatar_url) on public.profiles to authenticated;
revoke all on public.catalog_staging, public.sync_runs, public.sync_accounts, public.sync_jobs from anon, authenticated;
revoke insert, update, delete on public.catalog_index, public.title_detail_cache, public.rating_enrichment,
  public.title_stats from anon, authenticated;

revoke execute on function public.catalog_apply_staging(uuid) from public, anon, authenticated;
revoke execute on function public.catalog_purge_stale() from public, anon, authenticated;
revoke execute on function public.title_stats_apply(bigint, int, int, int, int) from public, anon, authenticated;
grant  execute on function public.handle_available(text) to anon, authenticated;
grant  execute on function public.catalog_page(text, text, jsonb, integer, integer[]) to anon, authenticated;
grant  execute on function public.catalog_count(text, integer[]) to anon, authenticated;
grant  execute on function public.catalog_search(text, text, integer) to anon, authenticated;
grant  execute on function public.last_catalog_sync() to anon, authenticated;
