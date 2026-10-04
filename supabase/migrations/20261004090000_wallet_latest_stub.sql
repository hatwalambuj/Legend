-- Stubbed: wallet stubs carry their latest stub (API_CONTRACT v1.6.1, WalletItem.latestStubId/latestSeason).
-- New file; not applied by this change. "Latest" = last in watch order (watched_on, created_at, id) ASC,
-- the same order that numbers stubs, so the latest stub's number = the wallet count.
-- The return table changes, so the function is dropped and recreated (no overload); grants re-issued.
drop function if exists public.user_wallet(uuid, jsonb, integer);

create function public.user_wallet(
  p_user uuid, p_after jsonb default null, p_limit integer default 20
) returns table (
  title_key text, count integer, last_watched_on date, last_created_at timestamptz, title jsonb,
  latest_stub_id uuid, latest_season smallint
) language sql stable security invoker set search_path = public as $$
  with g as (
    select s.title_id, count(*)::int as n, max(s.watched_on) as lw, max(s.created_at) as lc
      from public.stubs s where s.user_id = p_user group by s.title_id
  )
  select c.title_key, g.n, g.lw, g.lc, to_jsonb(c), l.id, l.season_number
    from g join public.catalog_index c on c.id = g.title_id
    cross join lateral (
      select s.id, s.season_number from public.stubs s
       where s.user_id = p_user and s.title_id = g.title_id
       order by s.watched_on desc, s.created_at desc, s.id desc
       limit 1
    ) l
   where p_after is null
      or g.lw < (p_after->>0)::date
      or (g.lw = (p_after->>0)::date
          and (g.lc < (p_after->>1)::timestamptz
               or (g.lc = (p_after->>1)::timestamptz and c.title_key > (p_after->>2))))
   order by g.lw desc, g.lc desc, c.title_key asc
   limit least(greatest(p_limit, 1), 51)
$$;

grant execute on function public.user_wallet(uuid, jsonb, integer) to anon, authenticated;
