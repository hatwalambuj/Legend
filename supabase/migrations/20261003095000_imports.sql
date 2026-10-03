-- =============================================================================
-- Stubbed: imports (ADR-013 C-11, API_CONTRACT v1.6 §5.26–§5.27). New file; needs 20261003091000.
-- Files are parsed in the browser; only matched, normalised rows reach these functions. Matching uses
-- only catalog_index (no lazy insert, no TMDB call).
--   * stubs.import_key (sha256 hex) + unique (user_id, import_key) → idempotent re-sends
--   * stubs_before_write / reviews_before_write: outside import_apply an API role can't set
--     source/import_key and the per-minute limits apply as before (the stub limit counts only
--     source='app' rows, so an import never locks out normal stubbing)
--   * import_apply(p_source, p_rows): security invoker (RLS, user = auth.uid()), <= 1000 rows, 20,000
--     imported stubs per 24 h, reviews only where none exist (never overwritten)
--   * catalog_match(p_items): security invoker, stable, <= 1000 items
-- =============================================================================

alter table public.stubs add column import_key text
  check (import_key is null or char_length(import_key) = 64);
create unique index stubs_import_key on public.stubs (user_id, import_key) where import_key is not null;

-- Lookups for catalog_match (title + imdb paths; tmdb uses unique (media_type, tmdb_id)).
create index catalog_sort_title_lookup on public.catalog_index (sort_title);
create index catalog_imdb_id_lookup on public.catalog_index (imdb_id) where imdb_id is not null;

create or replace function public.stubs_before_write()
returns trigger language plpgsql as $$
declare
  v_release date;
  v_type    text;
  v_recent  integer;
  v_api     boolean := current_user in ('anon', 'authenticated');
  v_bulk    boolean := current_setting('stubbed.bulk_import', true) is not distinct from 'on';
begin
  if new.watched_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'watched_on_in_future' using errcode = '22023';
  end if;
  select release_date, media_type into v_release, v_type from public.catalog_index where id = new.title_id;
  if v_release is not null and new.watched_on < make_date(extract(year from v_release)::int - 1, 1, 1) then
    raise exception 'watched_on_before_release' using errcode = '22023';
  end if;
  if new.season_number is not null and v_type is distinct from 'tv' then
    raise exception 'season_on_movie' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if v_api then
      new.created_at := now();
      new.updated_at := now();
      if not v_bulk then
        new.source := 'app';
        new.import_key := null;
      end if;
    end if;
    if not v_bulk then
      select count(*) into v_recent from public.stubs
        where user_id = new.user_id and source = 'app' and created_at > now() - interval '1 minute';
      if v_recent >= 30 then
        raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=60';
      end if;
    end if;
  else
    new.updated_at := now();
    if v_api then
      new.created_at := old.created_at;
      new.source := old.source;
      new.import_key := old.import_key;
    end if;
    if new.user_id <> old.user_id or new.title_id <> old.title_id then
      raise exception 'immutable_columns' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- Same body as 20260926180000_review_hardening.sql; the per-minute limit is skipped inside import_apply.
create or replace function public.reviews_before_write()
returns trigger language plpgsql as $$
declare
  v_recent  integer;
  v_api     boolean := current_user in ('anon', 'authenticated');
  v_bulk    boolean := current_setting('stubbed.bulk_import', true) is not distinct from 'on';
  v_content boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_content := new.rating_10 <> old.rating_10 or new.body <> old.body or new.is_spoiler <> old.is_spoiler;
  end if;
  if v_content and not v_bulk then
    select count(*) into v_recent from public.reviews
      where user_id = new.user_id and updated_at > now() - interval '1 minute'
        and (tg_op = 'INSERT' or id <> new.id);
    if v_recent >= 10 then
      raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=60';
    end if;
  end if;
  if new.stub_id is not null and not exists (
    select 1 from public.stubs s where s.id = new.stub_id and s.user_id = new.user_id and s.title_id = new.title_id
  ) then
    raise exception 'stub_mismatch' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if v_api then
      new.created_at := now();
      new.updated_at := now();
      new.edited_at := null;
    end if;
  else
    if new.user_id <> old.user_id or new.title_id <> old.title_id then
      raise exception 'immutable_columns' using errcode = '22023';
    end if;
    new.updated_at := now();
    if v_api then
      new.created_at := old.created_at;
      new.edited_at := old.edited_at;
    end if;
    if v_content then
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;

-- p_rows = [{ title_key, import_key, watched_on, season, rating_10, body, is_spoiler }]
-- Rows outside the stub date window are skipped (never abort the batch). Returns { stubs, reviews }.
create function public.import_apply(p_source text, p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_recent  integer;
  v_new     integer;
  v_stubs   integer;
  v_reviews integer;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if p_source not in ('letterboxd', 'imdb', 'tvtime') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  -- 24 h budget: 20,000 imported stubs (sum of rows; the app may configure less).
  select count(*) into v_recent from public.stubs
   where user_id = v_uid and source = 'import' and created_at > now() - interval '24 hours';
  select count(*) into v_new from jsonb_to_recordset(p_rows) as r(import_key text) where r.import_key is not null;
  if v_recent + v_new > 20000 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=3600';
  end if;

  perform set_config('stubbed.bulk_import', 'on', true);

  with rows as (
    select c.id as title_id, c.media_type, c.release_date, r.import_key, r.watched_on, r.season
      from jsonb_to_recordset(p_rows) as r(title_key text, import_key text, watched_on date, season smallint)
      join public.catalog_index c on c.title_key = r.title_key
     where r.import_key is not null and char_length(r.import_key) = 64 and r.watched_on is not null
       and r.watched_on <= (now() at time zone 'utc')::date + 1
       and (c.release_date is null or r.watched_on >= make_date(extract(year from c.release_date)::int - 1, 1, 1))
  ), ins as (
    insert into public.stubs (user_id, title_id, watched_on, season_number, source, import_key)
    select v_uid, title_id, watched_on,
           case when media_type = 'tv' and season between 1 and 200 then season end,
           'import', import_key
      from rows
    on conflict (user_id, import_key) where import_key is not null do nothing
    returning 1
  )
  select count(*) into v_stubs from ins;

  with rv as (
    select distinct on (c.id) c.id as title_id, r.rating_10, left(coalesce(r.body, ''), 5000) as body,
           coalesce(r.is_spoiler, false) as is_spoiler
      from jsonb_to_recordset(p_rows) as r(title_key text, rating_10 smallint, body text, is_spoiler boolean)
      join public.catalog_index c on c.title_key = r.title_key
     where r.rating_10 between 1 and 10
     order by c.id
  ), ins as (
    insert into public.reviews (user_id, title_id, rating_10, body, is_spoiler)
    select v_uid, rv.title_id, rv.rating_10, rv.body, rv.is_spoiler
      from rv
     where not exists (select 1 from public.reviews x where x.user_id = v_uid and x.title_id = rv.title_id)
    on conflict (user_id, title_id) do nothing
    returning 1
  )
  select count(*) into v_reviews from ins;

  perform set_config('stubbed.bulk_import', 'off', true);
  return jsonb_build_object('stubs', v_stubs, 'reviews', v_reviews);
end $$;

-- p_items = [{ ref, media_type, tmdb_id, imdb_id, title_norm, year }] (title_norm = normalizeSearch(title)).
-- tmdb id + type → imdb id (+ type) → sort_title + year ±1 + type; ties → highest vote_count.
create function public.catalog_match(p_items jsonb)
returns table (ref text, title jsonb)
language sql stable security invoker set search_path = public as $$
  select i.ref, to_jsonb(m) - 'pri'
    from (select * from jsonb_to_recordset(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
                 as x(ref text, media_type text, tmdb_id integer, imdb_id text, title_norm text, year integer)
           limit 1000) i
    cross join lateral (
      select z.* from (
        select c.*, 1 as pri from public.catalog_index c
         where i.tmdb_id is not null and i.media_type is not null
           and c.media_type = i.media_type and c.tmdb_id = i.tmdb_id
        union all
        select c.*, 2 from public.catalog_index c
         where i.imdb_id is not null and c.imdb_id = i.imdb_id
           and (i.media_type is null or c.media_type = i.media_type)
        union all
        select c.*, 3 from public.catalog_index c
         where i.title_norm is not null and i.title_norm <> '' and c.sort_title = i.title_norm
           and (i.media_type is null or c.media_type = i.media_type)
           and (i.year is null or abs(extract(year from c.release_date)::int - i.year) <= 1)
      ) z
      order by z.pri, z.vote_count desc, z.title_key
      limit 1
    ) m
   where i.ref is not null
$$;

revoke execute on function public.import_apply(text, jsonb) from public, anon;
grant  execute on function public.import_apply(text, jsonb) to authenticated;
grant  execute on function public.catalog_match(jsonb) to anon, authenticated;
