-- =============================================================================
-- Stubbed: bound the size of the anonymous events table (security review SR-1, ADR-013 C-09). New file.
-- POST /api/events is anonymous, and `provider_clicked` dims carry a client-chosen region + provider id,
-- so each request could create up to 20 NEW (day, name, dim) rows. The per-IP limiter lives in memory
-- per instance, so that alone does not bound table growth (free-tier DB size = availability).
--   * events_track: rows that already exist today are always incremented; at most
--     1,000 distinct (name, dim) rows are created per UTC day. Anything over that is dropped (counters
--     are best-effort). Ceiling: 1,000 rows/day x 400 days retention. Upgrade trigger: legitimate
--     dims/day near 1,000 (check `select count(*) from events where day = current_date`).
-- =============================================================================

create or replace function public.events_track(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_day   date := (now() at time zone 'utc')::date;
  v_room  integer;
  v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  select greatest(1000 - count(*), 0)::integer into v_room from public.events where day = v_day;
  with a as (
    select r.name, coalesce(r.dim, '') as dim, sum(least(greatest(coalesce(r.n, 1), 0), 10000)) as n
      from (select * from jsonb_to_recordset(p_rows) as x(name text, dim text, n bigint) limit 50) r
     where r.name ~ '^[a-z_]{3,40}$' and char_length(coalesce(r.dim, '')) <= 80
     group by 1, 2
  ), k as (
    select a.*, exists (select 1 from public.events e
                         where e.day = v_day and e.name = a.name and e.dim = a.dim) as known
      from a
  ), ranked as (
    select k.*, row_number() over (partition by k.known order by k.name, k.dim) as rn from k
  )
  insert into public.events as e (day, name, dim, count)
  select v_day, ranked.name, ranked.dim, ranked.n
    from ranked
   where ranked.known or ranked.rn <= v_room
  on conflict (day, name, dim) do update set count = e.count + excluded.count;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.events_track(jsonb) from public, anon, authenticated;
