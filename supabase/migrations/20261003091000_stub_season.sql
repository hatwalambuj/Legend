-- =============================================================================
-- Stubbed: season on show stubs (ADR-013 C-10, API_CONTRACT v1.6 §5.7/§5.8). New file.
-- The column already exists (init: stubs.season_number smallint).
--   * range check 1..200; a season on a movie → 'season_on_movie' (22023) in stubs_before_write
--   * stub_details gets `season` appended at the END (column append only)
--   * stub_insert(…, p_season smallint default null): dropped and recreated, no overload
-- =============================================================================

alter table public.stubs add constraint stubs_season_range
  check (season_number is null or season_number between 1 and 200);

-- Same body as 20260926180000_review_hardening.sql plus the movie check.
create or replace function public.stubs_before_write()
returns trigger language plpgsql as $$
declare
  v_release date;
  v_type    text;
  v_recent  integer;
  v_api     boolean := current_user in ('anon', 'authenticated');
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

create or replace view public.stub_details with (security_invoker = true) as
  select s.id, s.user_id, s.title_id, c.title_key, s.watched_on, s.watched_where, s.note,
         s.created_at, s.updated_at,
         (select count(*)::int from public.stubs x
           where x.user_id = s.user_id and x.title_id = s.title_id
             and (x.watched_on, x.created_at, x.id) <= (s.watched_on, s.created_at, s.id)) as number,
         s.season_number as season
    from public.stubs s
    join public.catalog_index c on c.id = s.title_id;

drop function if exists public.stub_insert(text, date, text, text);

create function public.stub_insert(
  p_title_key text, p_watched_on date, p_watched_where text, p_note text, p_season smallint default null
) returns setof public.stub_details
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.stubs (user_id, title_id, watched_on, watched_where, note, season_number)
  select auth.uid(), c.id, p_watched_on, p_watched_where, coalesce(p_note, ''), p_season
    from public.catalog_index c where c.title_key = p_title_key
  returning id into v_id;
  if v_id is null then raise exception 'unknown_title' using errcode = 'P0002'; end if;
  return query select * from public.stub_details where id = v_id;
end $$;

revoke execute on function public.stub_insert(text, date, text, text, smallint) from public, anon;
grant  execute on function public.stub_insert(text, date, text, text, smallint) to authenticated;

-- The diary RPC returns the season too (return type changes → drop + create, same grants).
drop function if exists public.user_diary(uuid, text, jsonb, integer);

create function public.user_diary(
  p_user uuid, p_type text default 'all', p_after jsonb default null, p_limit integer default 20
) returns table (
  id uuid, title_key text, watched_on date, watched_where text, note text,
  created_at timestamptz, updated_at timestamptz, number integer, title jsonb, season smallint
) language sql stable security invoker set search_path = public as $$
  select s.id, c.title_key, s.watched_on, s.watched_where, s.note, s.created_at, s.updated_at,
         (select count(*)::int from public.stubs x
           where x.user_id = s.user_id and x.title_id = s.title_id
             and (x.watched_on, x.created_at, x.id) <= (s.watched_on, s.created_at, s.id)),
         to_jsonb(c),
         s.season_number
    from public.stubs s
    join public.catalog_index c on c.id = s.title_id
   where s.user_id = p_user
     and (p_type = 'all' or c.media_type = p_type)
     and (p_after is null
          or s.watched_on < (p_after->>0)::date
          or (s.watched_on = (p_after->>0)::date
              and (s.created_at < (p_after->>1)::timestamptz
                   or (s.created_at = (p_after->>1)::timestamptz and s.id > (p_after->>2)::uuid))))
   order by s.watched_on desc, s.created_at desc, s.id asc
   limit least(greatest(p_limit, 1), 51)
$$;

grant execute on function public.user_diary(uuid, text, jsonb, integer) to anon, authenticated;
