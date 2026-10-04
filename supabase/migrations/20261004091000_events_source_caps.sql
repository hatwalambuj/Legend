-- =============================================================================
-- Stubbed: separate daily caps per event source (arch review AR-C4, ADR-013 C-09). New file.
-- 096 shared one 1,000-new-rows/day cap between anonymous client events and server events, so ~50
-- anonymous `/api/events` requests could fill the day and starve `signup_completed`, `stub_created`,
-- `server_error`, ... Now:
--   * client source = the names `POST /api/events` accepts (`client: true` in src/lib/analytics.ts;
--     tests/db/closeout.test.ts checks this list against CLIENT_EVENT_NAMES): <= 1,000 new rows/day.
--   * server source = every other name (fixed, server-chosen dims): its own <= 300 new rows/day.
--   * rows that already exist today are always incremented (unchanged).
-- Ceiling: 1,300 rows/day x 400 days retention. Upgrade trigger: either source near its cap
-- (`select name in ('share_generated','worth_it_viewed','provider_clicked') as client, count(*)
--   from events where day = current_date group by 1`).
-- =============================================================================

create or replace function public.events_track(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_day     date := (now() at time zone 'utc')::date;
  v_clients text[] := array['share_generated', 'worth_it_viewed', 'provider_clicked'];
  v_room_c  integer;
  v_room_s  integer;
  v_count   integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  select greatest(1000 - count(*) filter (where name = any(v_clients)), 0)::integer,
         greatest(300 - count(*) filter (where not (name = any(v_clients))), 0)::integer
    into v_room_c, v_room_s
    from public.events where day = v_day;
  with a as (
    select r.name, coalesce(r.dim, '') as dim, sum(least(greatest(coalesce(r.n, 1), 0), 10000)) as n
      from (select * from jsonb_to_recordset(p_rows) as x(name text, dim text, n bigint) limit 50) r
     where r.name ~ '^[a-z_]{3,40}$' and char_length(coalesce(r.dim, '')) <= 80
     group by 1, 2
  ), k as (
    select a.*, (a.name = any(v_clients)) as is_client,
           exists (select 1 from public.events e
                    where e.day = v_day and e.name = a.name and e.dim = a.dim) as known
      from a
  ), ranked as (
    select k.*, row_number() over (partition by k.known, k.is_client order by k.name, k.dim) as rn
      from k
  )
  insert into public.events as e (day, name, dim, count)
  select v_day, ranked.name, ranked.dim, ranked.n
    from ranked
   where ranked.known
      or ranked.rn <= case when ranked.is_client then v_room_c else v_room_s end
  on conflict (day, name, dim) do update set count = e.count + excluded.count;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.events_track(jsonb) from public, anon, authenticated;
