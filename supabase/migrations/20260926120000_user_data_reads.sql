-- =============================================================================
-- Stubbed — user-data read functions + non-write rate limits (Backend, ADR-003/004/005).
-- Adds only views/functions/one table; the init migration is untouched.
-- Every read function is SECURITY INVOKER, so RLS still applies (stubs/reviews/profiles/catalogue are
-- public-read; the watchlist is owner-only). Keyset orders match the indexes in the init migration and
-- the demo repositories (src/server/repositories/memory/user-data.ts). Tested in tests/db/user-data.test.ts.
-- =============================================================================

-- A stub with its watch number: 1-based rank by (watched_on, created_at, id) within (user, title).
-- The correlated count uses stubs_user_title and is evaluated only for the rows a query returns.
create view public.stub_details with (security_invoker = true) as
  select s.id, s.user_id, s.title_id, c.title_key, s.watched_on, s.watched_where, s.note,
         s.created_at, s.updated_at,
         (select count(*)::int from public.stubs x
           where x.user_id = s.user_id and x.title_id = s.title_id
             and (x.watched_on, x.created_at, x.id) <= (s.watched_on, s.created_at, s.id)) as number
    from public.stubs s
    join public.catalog_index c on c.id = s.title_id;

-- A review with its public author and the number of its linked stub ("STUB #2").
create view public.review_details with (security_invoker = true) as
  select r.id, r.user_id, r.title_id, c.title_key, r.rating_10, r.body, r.is_spoiler, r.stub_id,
         (select sd.number from public.stub_details sd where sd.id = r.stub_id) as stub_number,
         r.created_at, r.updated_at, r.edited_at,
         jsonb_build_object('id', p.id, 'handle', p.handle::text, 'displayName', p.display_name,
                            'bio', p.bio, 'avatarUrl', p.avatar_url, 'createdAt', p.created_at) as author
    from public.reviews r
    join public.catalog_index c on c.id = r.title_id
    join public.profiles p on p.id = r.user_id;

grant select on public.stub_details, public.review_details to anon, authenticated;

-- Insert a stub for the calling user by title key (one round trip). The stubs_before_write trigger
-- validates dates and the 30/min rate limit; RLS checks user_id = auth.uid().
create or replace function public.stub_insert(
  p_title_key text, p_watched_on date, p_watched_where text, p_note text
) returns setof public.stub_details
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.stubs (user_id, title_id, watched_on, watched_where, note)
  select auth.uid(), c.id, p_watched_on, p_watched_where, coalesce(p_note, '')
    from public.catalog_index c where c.title_key = p_title_key
  returning id into v_id;
  if v_id is null then raise exception 'unknown_title' using errcode = 'P0002'; end if;
  return query select * from public.stub_details where id = v_id;
end $$;

-- Diary (API_CONTRACT §5.10): watched_on DESC, created_at DESC, id ASC. p_after = [watched_on, created_at, id].
create or replace function public.user_diary(
  p_user uuid, p_type text default 'all', p_after jsonb default null, p_limit integer default 20
) returns table (
  id uuid, title_key text, watched_on date, watched_where text, note text,
  created_at timestamptz, updated_at timestamptz, number integer, title jsonb
) language sql stable security invoker set search_path = public as $$
  select s.id, c.title_key, s.watched_on, s.watched_where, s.note, s.created_at, s.updated_at,
         (select count(*)::int from public.stubs x
           where x.user_id = s.user_id and x.title_id = s.title_id
             and (x.watched_on, x.created_at, x.id) <= (s.watched_on, s.created_at, s.id)),
         to_jsonb(c)
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

-- Wallet (one torn stub per title): last watched DESC, last created DESC, title_key ASC.
create or replace function public.user_wallet(
  p_user uuid, p_after jsonb default null, p_limit integer default 20
) returns table (
  title_key text, count integer, last_watched_on date, last_created_at timestamptz, title jsonb
) language sql stable security invoker set search_path = public as $$
  with g as (
    select s.title_id, count(*)::int as n, max(s.watched_on) as lw, max(s.created_at) as lc
      from public.stubs s where s.user_id = p_user group by s.title_id
  )
  select c.title_key, g.n, g.lw, g.lc, to_jsonb(c)
    from g join public.catalog_index c on c.id = g.title_id
   where p_after is null
      or g.lw < (p_after->>0)::date
      or (g.lw = (p_after->>0)::date
          and (g.lc < (p_after->>1)::timestamptz
               or (g.lc = (p_after->>1)::timestamptz and c.title_key > (p_after->>2))))
   order by g.lw desc, g.lc desc, c.title_key asc
   limit least(greatest(p_limit, 1), 51)
$$;

-- Reviews of a title. newest: created_at DESC, id ASC (reviews_title_newest);
-- highest: rating_10 DESC, created_at DESC, id ASC (reviews_title_highest).
create or replace function public.title_reviews(
  p_title_key text, p_sort text default 'newest', p_after jsonb default null, p_limit integer default 20
) returns setof public.review_details
language sql stable security invoker set search_path = public as $$
  select v.* from public.review_details v
   where v.title_id = (select c.id from public.catalog_index c where c.title_key = p_title_key)
     and (p_after is null
          or (p_sort = 'highest' and (
                v.rating_10 < (p_after->>0)::int
                or (v.rating_10 = (p_after->>0)::int
                    and (v.created_at < (p_after->>1)::timestamptz
                         or (v.created_at = (p_after->>1)::timestamptz and v.id > (p_after->>2)::uuid)))))
          or (p_sort <> 'highest' and (
                v.created_at < (p_after->>0)::timestamptz
                or (v.created_at = (p_after->>0)::timestamptz and v.id > (p_after->>1)::uuid))))
   order by case when p_sort = 'highest' then v.rating_10 end desc nulls last,
            v.created_at desc, v.id asc
   limit least(greatest(p_limit, 1), 51)
$$;

-- A user's reviews (profile tab): created_at DESC, id ASC (reviews_user), with the title row.
create or replace function public.user_reviews(
  p_user uuid, p_after jsonb default null, p_limit integer default 20
) returns table (review jsonb, title jsonb)
language sql stable security invoker set search_path = public as $$
  select to_jsonb(v), to_jsonb(c)
    from public.review_details v join public.catalog_index c on c.id = v.title_id
   where v.user_id = p_user
     and (p_after is null
          or v.created_at < (p_after->>0)::timestamptz
          or (v.created_at = (p_after->>0)::timestamptz and v.id > (p_after->>1)::uuid))
   order by v.created_at desc, v.id asc
   limit least(greatest(p_limit, 1), 51)
$$;

-- Personal state for up to 60 titles in ONE call (no N+1). Watchlist rows are only visible to their
-- owner (RLS), so passing someone else's id yields watchlisted = false.
create or replace function public.user_title_states(p_user uuid, p_keys text[], p_today date)
returns table (
  title_key text, stub_count integer, last_watched_on date, has_stub_today boolean,
  watchlisted boolean, review_id uuid
) language sql stable security invoker set search_path = public as $$
  select c.title_key,
         coalesce(s.n, 0), s.lw, coalesce(s.today, false),
         exists (select 1 from public.watchlist w where w.user_id = p_user and w.title_id = c.id),
         (select r.id from public.reviews r where r.user_id = p_user and r.title_id = c.id)
    from public.catalog_index c
    left join lateral (
      select count(*)::int as n, max(x.watched_on) as lw, bool_or(x.watched_on = p_today) as today
        from public.stubs x where x.user_id = p_user and x.title_id = c.id
    ) s on true
   where c.title_key = any (p_keys[1:60])
$$;

-- Community aggregates by key (trigger-maintained title_stats; zeros when absent).
create or replace function public.title_stats_by_key(p_title_key text)
returns table (stub_count integer, review_count integer, rating_sum integer, rating_count integer)
language sql stable security invoker set search_path = public as $$
  select coalesce(t.stub_count, 0), coalesce(t.review_count, 0),
         coalesce(t.rating_sum, 0), coalesce(t.rating_count, 0)
    from public.catalog_index c
    left join public.title_stats t on t.title_id = c.id
   where c.title_key = p_title_key
$$;

-- Profile header stats (ProfileStats) + the most recently stubbed title (adaptive background).
create or replace function public.profile_stats(p_user uuid, p_year integer)
returns jsonb language sql stable security invoker set search_path = public as $$
  with g as (
    select s.title_id, count(*)::int as n, max(s.watched_on) as lw
      from public.stubs s where s.user_id = p_user group by s.title_id
  )
  select jsonb_build_object(
    'total_stubs', coalesce((select sum(n) from g), 0),
    'stubs_this_year', (select count(*) from public.stubs s
                         where s.user_id = p_user
                           and s.watched_on >= make_date(p_year, 1, 1)
                           and s.watched_on < make_date(p_year + 1, 1, 1)),
    'titles_stubbed', (select count(*) from g),
    'review_count', (select count(*) from public.reviews r where r.user_id = p_user),
    'most_stubbed', (select jsonb_build_object('count', g.n, 'title', to_jsonb(c))
                       from g join public.catalog_index c on c.id = g.title_id
                      order by g.n desc, g.lw desc, c.title_key asc limit 1),
    'latest', (select to_jsonb(c) from public.stubs s join public.catalog_index c on c.id = s.title_id
                where s.user_id = p_user
                order by s.watched_on desc, s.created_at desc, s.id asc limit 1)
  )
$$;

grant execute on function public.user_diary(uuid, text, jsonb, integer) to anon, authenticated;
grant execute on function public.user_wallet(uuid, jsonb, integer) to anon, authenticated;
grant execute on function public.title_reviews(text, text, jsonb, integer) to anon, authenticated;
grant execute on function public.user_reviews(uuid, jsonb, integer) to anon, authenticated;
grant execute on function public.user_title_states(uuid, text[], date) to authenticated;
grant execute on function public.title_stats_by_key(text) to anon, authenticated;
grant execute on function public.profile_stats(uuid, integer) to anon, authenticated;
revoke execute on function public.stub_insert(text, date, text, text) from public, anon;
grant  execute on function public.stub_insert(text, date, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Rate limits outside the stub/review triggers (export 1 per 10 min, …), correct across instances.
-- Only reachable through consume_rate_limit(); the table itself is invisible to API roles.
-- -----------------------------------------------------------------------------
create table public.rate_events (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  kind     text not null check (char_length(kind) between 1 and 40),
  at       timestamptz not null default now()
);
create index rate_events_lookup on public.rate_events (user_id, kind, at desc);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- Returns 0 and records a hit when allowed, else the seconds until the next hit is allowed.
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
  delete from public.rate_events
   where user_id = v_uid and kind = p_kind and at <= now() - make_interval(secs => v_window);
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
