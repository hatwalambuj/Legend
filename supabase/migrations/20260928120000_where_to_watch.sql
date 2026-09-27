-- =============================================================================
-- Stubbed: "Where to watch" (ADR-012 §3, API_CONTRACT v1.5). New file; never edit an applied migration.
--   * catalog_index.watch / watch_checked_at / watch_tags  — region-agnostic availability (nightly job only)
--   * watch_provider                                        — provider names, logos, per-region priority
--   * user_settings                                         — owner-only saved region (NOT on public profiles)
--   * RPCs catalog_set_watch, catalog_watch_due, watch_provider_set_priorities (job only, service role)
--   * RPC  user_settings_set_watch_region                   — the signed-in user's own row (RLS applies)
-- Data: TMDB watch/providers (JustWatch). Deterministic, no AI (D15). Nothing is posted anywhere (ADR-008).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catalogue columns
-- -----------------------------------------------------------------------------
alter table public.catalog_index
  -- {"US":{"s":[8,337],"a":[73],"r":[2,3],"b":[2,3,10]}, ...}; null = never fetched
  add column watch            jsonb,
  -- last successful watch fetch (enrich or watch step); null = never. Hidden after 30 days (read path).
  add column watch_checked_at timestamptz,
  -- 'US:8' for every provider in s|f|a of region US (P1 browse filter)
  add column watch_tags       text[] not null default '{}';

alter table public.catalog_index add constraint catalog_watch_shape
  check (watch is null or (jsonb_typeof(watch) = 'object' and pg_column_size(watch) <= 4096));

create index catalog_watch_due  on public.catalog_index (watch_checked_at nulls first, id)
  where source_status = 'active';
create index catalog_watch_tags on public.catalog_index using gin (watch_tags) where is_listed;

-- -----------------------------------------------------------------------------
-- Providers (names/logos from every fetch; priorities from the weekly provider-list sync)
-- -----------------------------------------------------------------------------
create table public.watch_provider (
  provider_id   integer primary key check (provider_id > 0),
  name          text not null check (char_length(name) between 1 and 80),
  logo_path     text check (logo_path is null or logo_path ~ '^/[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg)$'),
  priorities    jsonb not null default '{}'::jsonb check (jsonb_typeof(priorities) = 'object'),  -- {"US": 1, "GB": 3}
  updated_at    timestamptz not null default now(),
  -- last provider-list sync that wrote this row's priorities; null = never. The weekly step runs when
  -- max(priorities_at) is older than 7 days (updated_at also moves on name/logo upserts, so it can't).
  priorities_at timestamptz
);

comment on table public.watch_provider is
  'TMDB watch providers (JustWatch data): display names, logo paths and per-region display priority.';

-- -----------------------------------------------------------------------------
-- Per-user settings. NOT on profiles: profiles is public-read and a country is personal (ADR-012 §3).
-- Deleted with the account (on delete cascade from auth.users; DELETE /api/me).
-- -----------------------------------------------------------------------------
create table public.user_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  watch_region text check (watch_region is null or watch_region ~ '^[A-Z]{2}$'),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Helpers + RPCs
-- -----------------------------------------------------------------------------

-- 'R:id' tags for the stream/free/ads lists of every region in a watch object (P1 filter, W7).
create or replace function public.watch_tags_of(p_watch jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct e.key || ':' || v.id order by e.key || ':' || v.id), '{}')
    from jsonb_each(case when jsonb_typeof(p_watch) = 'object' then p_watch else '{}'::jsonb end) e
    cross join lateral (values ('s'), ('f'), ('a')) t(k)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(e.value -> t.k) = 'array' then e.value -> t.k else '[]'::jsonb end) v(id)
   where e.key ~ '^[A-Z]{2}$' and v.id ~ '^[1-9][0-9]{0,9}$'
$$;

-- p_rows = [{ id, watch: {...}, providers: [{ provider_id, name, logo_path }] }, ...]
-- Sets watch + watch_checked_at = now() + watch_tags; upserts provider names/logos (priorities untouched).
-- A row whose `watch` is not a JSON object is skipped (a failed/absent fetch never wipes stored data).
create or replace function public.catalog_set_watch(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.watch_provider as w (provider_id, name, logo_path)
  select distinct on (p.provider_id)
         p.provider_id,
         left(btrim(p.name), 80),
         case when p.logo_path ~ '^/[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg)$' then p.logo_path end
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(id bigint, watch jsonb, providers jsonb)
    cross join lateral jsonb_to_recordset(
      case when jsonb_typeof(r.providers) = 'array' then r.providers else '[]'::jsonb end)
      as p(provider_id integer, name text, logo_path text)
   where p.provider_id > 0 and char_length(btrim(coalesce(p.name, ''))) >= 1
   order by p.provider_id
  on conflict (provider_id) do update
    set name = excluded.name, logo_path = excluded.logo_path, updated_at = now()
    where (w.name, w.logo_path) is distinct from (excluded.name, excluded.logo_path);

  update public.catalog_index c set
    watch            = r.watch,
    watch_checked_at = now(),
    watch_tags       = public.watch_tags_of(r.watch)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(id bigint, watch jsonb, providers jsonb)
  where c.id = r.id and jsonb_typeof(r.watch) = 'object';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Due for a standalone watch fetch (ADR-012 §4): active rows never checked, hot rows older than
-- p_hot_days, or any row older than p_ttl_days. Hot = listed and (top p_hot_top by popularity per
-- media type, or released in the last 60 days): the trending and new rails.
-- A 2-hour slack keeps "daily" rows due on a nightly cron that drifts by a few minutes.
create or replace function public.catalog_watch_due(
  p_limit integer, p_ttl_days integer default 7, p_hot_days integer default 1, p_hot_top integer default 50)
returns table (id bigint, media_type text, tmdb_id integer)
language sql stable security definer set search_path = public as $$
  with hot as (
    select h.id from (
      select c.id, c.release_date,
             row_number() over (partition by c.media_type order by c.popularity desc, c.id) as rn
        from public.catalog_index c
       where c.is_listed and c.source_status = 'active') h
     where h.rn <= greatest(p_hot_top, 0) or h.release_date >= current_date - 60
  )
  select c.id, c.media_type, c.tmdb_id
    from public.catalog_index c
    left join hot on hot.id = c.id
   where c.source_status = 'active'
     and (c.watch_checked_at is null
          or (hot.id is not null
              and c.watch_checked_at < now() - make_interval(days => greatest(p_hot_days, 0)) + interval '2 hours')
          or c.watch_checked_at < now() - make_interval(days => greatest(p_ttl_days, 1)) + interval '2 hours')
   order by (c.watch_checked_at is null) desc, (hot.id is not null) desc, c.watch_checked_at asc nulls first,
            c.is_listed desc, c.popularity desc, c.id
   limit greatest(p_limit, 0)
$$;

-- p_rows = [{ provider_id, name, logo_path, priorities: {"US": 1, ...} }] from the weekly list sync.
-- Replaces priorities (a region that no longer lists a provider drops out) and stamps priorities_at.
create or replace function public.watch_provider_set_priorities(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.watch_provider as w (provider_id, name, logo_path, priorities, priorities_at)
  select distinct on (p.provider_id)
         p.provider_id,
         left(btrim(p.name), 80),
         case when p.logo_path ~ '^/[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg)$' then p.logo_path end,
         case when jsonb_typeof(p.priorities) = 'object' then p.priorities else '{}'::jsonb end,
         now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as p(provider_id integer, name text, logo_path text, priorities jsonb)
   where p.provider_id > 0 and char_length(btrim(coalesce(p.name, ''))) >= 1
   order by p.provider_id
  on conflict (provider_id) do update
    set name = excluded.name, logo_path = excluded.logo_path, priorities = excluded.priorities,
        priorities_at = now(), updated_at = now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The signed-in user's saved region (null = automatic). SECURITY INVOKER: RLS + column grants apply,
-- the row is always the caller's own (auth.uid()); anon can't execute it.
create or replace function public.user_settings_set_watch_region(p_region text)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  insert into public.user_settings as s (user_id, watch_region, updated_at)
  values (v_uid, p_region, now())
  on conflict (user_id) do update set watch_region = excluded.watch_region, updated_at = now();
  return p_region;
end $$;

-- -----------------------------------------------------------------------------
-- RLS + privileges
-- -----------------------------------------------------------------------------
alter table public.watch_provider enable row level security;
alter table public.user_settings  enable row level security;

create policy watch_provider_read on public.watch_provider for select to anon, authenticated using (true);

create policy user_settings_read   on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.watch_provider from anon, authenticated;
revoke all on public.user_settings from anon, authenticated;
grant  select on public.user_settings to authenticated;
grant  insert (user_id, watch_region, updated_at) on public.user_settings to authenticated;
grant  update (watch_region, updated_at) on public.user_settings to authenticated;
-- The new catalog_index columns inherit the existing public read and write revoke (init migration).

revoke execute on function public.catalog_set_watch(jsonb) from public, anon, authenticated;
revoke execute on function public.catalog_watch_due(integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.watch_provider_set_priorities(jsonb) from public, anon, authenticated;
revoke execute on function public.user_settings_set_watch_region(text) from public, anon;
grant  execute on function public.user_settings_set_watch_region(text) to authenticated;
