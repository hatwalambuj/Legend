-- =============================================================================
-- Stubbed: first-party, privacy-safe analytics (ADR-013 C-09). New file.
--   * events: anonymous DAILY counters — no user id, title key, IP, UA or URL, aggregated on write.
--   * events_track(p_rows): upsert-add into today's (UTC) bucket, <= 50 rows per call (service role).
--   * events_purge(p_days): retention, run by the nightly job.
--   * metrics_weekly: computed from tables we already hold (nothing new about a person is stored);
--     read by the service role only (`npx tsx scripts/metrics.ts`).
-- =============================================================================

create table public.events (
  day   date   not null,
  name  text   not null check (name ~ '^[a-z_]{3,40}$'),
  dim   text   not null default '' check (char_length(dim) <= 80),
  count bigint not null default 0 check (count >= 0),
  primary key (day, name, dim)
);
alter table public.events enable row level security;          -- no policies: no anon/auth access
revoke all on public.events from anon, authenticated;

-- p_rows = [{ name, dim, n }]
create function public.events_track(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then return 0; end if;
  insert into public.events as e (day, name, dim, count)
  select (now() at time zone 'utc')::date, r.name, coalesce(r.dim, ''), sum(least(greatest(coalesce(r.n, 1), 0), 10000))
    from (select * from jsonb_to_recordset(p_rows) as x(name text, dim text, n bigint) limit 50) r
   where r.name ~ '^[a-z_]{3,40}$' and char_length(coalesce(r.dim, '')) <= 80
   group by 1, 2, 3
  on conflict (day, name, dim) do update set count = e.count + excluded.count;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.events_purge(p_days int default 400)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from public.events where day < (now() at time zone 'utc')::date - greatest(coalesce(p_days, 400), 30);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ISO weeks (Monday start, UTC), the last 8 including the current one.
create view public.metrics_weekly with (security_invoker = true) as
with weeks as (
  select generate_series(
           date_trunc('week', (now() at time zone 'utc') - interval '7 weeks'),
           date_trunc('week', (now() at time zone 'utc')),
           interval '1 week')::date as week
),
stub_w as (
  select date_trunc('week', s.created_at at time zone 'utc')::date as week,
         count(distinct s.user_id) filter (where s.source = 'app') as was,
         count(*) as stubs,
         count(*) filter (where exists (
           select 1 from public.stubs x
            where x.user_id = s.user_id and x.title_id = s.title_id
              and (x.watched_on, x.created_at, x.id) < (s.watched_on, s.created_at, s.id))) as rewatches
    from public.stubs s
   where s.created_at >= date_trunc('week', now()) - interval '7 weeks'
   group by 1
),
signup_w as (
  select date_trunc('week', p.created_at at time zone 'utc')::date as week,
         count(*) as signups,
         count(*) filter (where (select count(*) from public.stubs s
                                  where s.user_id = p.id and s.created_at < p.created_at + interval '24 hours') >= 3) as activated,
         percentile_cont(0.5) within group (
           order by extract(epoch from (f.first_stub - p.created_at)) / 3600.0) as median_hours_to_first_stub
    from public.profiles p
    left join lateral (select min(s.created_at) as first_stub from public.stubs s where s.user_id = p.id) f on true
   where p.created_at >= date_trunc('week', now()) - interval '7 weeks'
   group by 1
),
review_w as (
  select date_trunc('week', r.created_at at time zone 'utc')::date as week, count(*) as reviews
    from public.reviews r
   where r.created_at >= date_trunc('week', now()) - interval '7 weeks'
   group by 1
),
event_w as (
  select w.week, jsonb_object_agg(w.name, w.total) as events
    from (select date_trunc('week', e.day)::date as week, e.name, sum(e.count) as total
            from public.events e
           where e.day >= (date_trunc('week', now()) - interval '7 weeks')::date
           group by 1, 2) w
   group by 1
)
select wk.week,
       coalesce(s.was, 0)                                       as weekly_active_stubbers,
       coalesce(g.signups, 0)                                   as signups,
       coalesce(g.activated, 0)                                 as activated,
       round(g.median_hours_to_first_stub::numeric, 1)          as median_hours_to_first_stub,
       coalesce(s.stubs, 0)                                     as stubs,
       coalesce(r.reviews, 0)                                   as reviews,
       case when coalesce(s.stubs, 0) > 0 then round(coalesce(r.reviews, 0)::numeric / s.stubs, 3) end as review_rate,
       case when coalesce(s.stubs, 0) > 0 then round(s.rewatches::numeric / s.stubs, 3) end           as rewatch_share,
       coalesce(e.events, '{}'::jsonb)                          as events
  from weeks wk
  left join stub_w s on s.week = wk.week
  left join signup_w g on g.week = wk.week
  left join review_w r on r.week = wk.week
  left join event_w e on e.week = wk.week
 order by wk.week desc;

revoke execute on function public.events_track(jsonb), public.events_purge(int) from public, anon, authenticated;
revoke all on public.metrics_weekly from anon, authenticated;
