-- =============================================================================
-- Ops health (ADR-011 §3, §9; CODE_REVIEW F1). New file: never edit an applied migration.
-- 1. last_catalog_sync() counts only FULL catalogue syncs: discover ran and applied the staging run.
--    Aborted, failed, dry and single-step (--only=enrich|imdb) runs don't count.
-- 2. health_probe(): one cheap, uncached round trip for GET /api/health and the keep-alive step.
-- =============================================================================

create or replace function public.last_catalog_sync()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(finished_at) from public.sync_runs
   where kind = 'catalog' and status = 'ok'
     and counts ? 'discover' and (counts -> 'discover') ? 'applied'
$$;

create or replace function public.health_probe()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'catalog_count', public.catalog_count('all'),
    'last_full_sync_at', public.last_catalog_sync())
$$;

revoke all on function public.health_probe() from public;
grant execute on function public.health_probe() to anon, authenticated, service_role;
