-- =============================================================================
-- Stubbed — reviewer hardening (docs/05-review/REVIEW.md). New file; earlier migrations are untouched.
--
-- 1. Server-controlled columns. PostgREST lets an API role write every column its RLS policy allows,
--    so a signed-in user calling Supabase directly (anon key + own JWT) could back-date `created_at`
--    to dodge the 30 stubs / 10 reviews per minute triggers, pin a review to the top of "Newest"
--    with a future `created_at`, or clear `edited_at`. For the API roles (anon/authenticated) the
--    triggers now own `created_at`, `updated_at` and `edited_at`. The service role (jobs, imports)
--    and table owner (tests) keep full control.
-- 2. The review rate limit counts inserts and content edits only. Re-linking or the FK
--    `stub_id … on delete set null` (deleting a linked stub) no longer trips it.
-- 3. `consume_rate_limit()` prunes the caller's stale events of every kind (bounded table size).
-- 4. `profiles.avatar_url` must be https (the API already enforces it; now the database does too).
-- 5. `user_diary_count()` for DiaryResponse.total and MeResponse.stubCount (contract v1.2).
-- =============================================================================

create or replace function public.stubs_before_write()
returns trigger language plpgsql as $$
declare
  v_release date;
  v_recent  integer;
  v_api     boolean := current_user in ('anon', 'authenticated');
begin
  if new.watched_on > (now() at time zone 'utc')::date + 1 then
    raise exception 'watched_on_in_future' using errcode = '22023';
  end if;
  select release_date into v_release from public.catalog_index where id = new.title_id;
  if v_release is not null and new.watched_on < make_date(extract(year from v_release)::int - 1, 1, 1) then
    raise exception 'watched_on_before_release' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if v_api then
      new.created_at := now();
      new.updated_at := now();
    end if;
    select count(*) into v_recent from public.stubs
      where user_id = new.user_id and created_at > now() - interval '1 minute';
    if v_recent >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001', hint = 'retry_after=60';
    end if;
  else
    new.updated_at := now();
    if v_api then
      new.created_at := old.created_at;
    end if;
    if new.user_id <> old.user_id or new.title_id <> old.title_id then
      raise exception 'immutable_columns' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

create or replace function public.reviews_before_write()
returns trigger language plpgsql as $$
declare
  v_recent  integer;
  v_api     boolean := current_user in ('anon', 'authenticated');
  v_content boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_content := new.rating_10 <> old.rating_10 or new.body <> old.body or new.is_spoiler <> old.is_spoiler;
  end if;
  if v_content then
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

create or replace function public.consume_rate_limit(p_kind text, p_max integer, p_window_secs integer)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_max    integer := least(greatest(coalesce(p_max, 1), 1), 1000);
  v_window integer := least(greatest(coalesce(p_window_secs, 60), 1), 86400);
  v_block  timestamptz;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_kind));
  -- Windows are capped at one day, so anything older is dead weight for every kind.
  delete from public.rate_events
   where user_id = v_uid
     and (at <= now() - interval '1 day'
          or (kind = p_kind and at <= now() - make_interval(secs => v_window)));
  select e.at into v_block from public.rate_events e
   where e.user_id = v_uid and e.kind = p_kind
   order by e.at desc offset v_max - 1 limit 1;
  if v_block is not null then
    return greatest(1, ceil(extract(epoch from (v_block + make_interval(secs => v_window) - now())))::int);
  end if;
  insert into public.rate_events (user_id, kind) values (v_uid, p_kind);
  return 0;
end $$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon;
grant  execute on function public.consume_rate_limit(text, integer, integer) to authenticated;

alter table public.profiles
  add constraint profiles_avatar_https check (avatar_url is null or avatar_url ~* '^https://');

-- Number of a user's stubs (all or one media type). Public data (stubs are public-read), invoker rights.
create or replace function public.user_diary_count(p_user uuid, p_type text default 'all')
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::int
    from public.stubs s
    join public.catalog_index c on c.id = s.title_id
   where s.user_id = p_user
     and (p_type = 'all' or c.media_type = p_type)
$$;

grant execute on function public.user_diary_count(uuid, text) to anon, authenticated;
