-- =============================================================================
-- Stubbed: gone rows leave the nightly enrich queue (arch review AR-C3, ADR-002 §4). New file.
-- `catalog_mark_gone` only sets source_status = 'gone'. A gone row that a stub/review/watchlist still
-- references is never purged, its synced_at stays > 120 days old, so 092's catalog_enrich_due sorted it
-- FIRST every night: one TMDB 404 + 100 ms per row per night, forever, out of SYNC_ENRICH_MAX.
-- Now only `source_status = 'active'` rows are due. A title that comes back in the TMDB export is set
-- active again by catalog_upsert (init) and re-enters the queue. Same signature and return type.
-- =============================================================================

create or replace function public.catalog_enrich_due(p_limit integer, p_ttl_days integer default 30)
returns table (id bigint, media_type text, tmdb_id integer, is_listed boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.media_type, c.tmdb_id, c.is_listed from public.catalog_index c
   where c.source_status = 'active'
     and (c.enriched_at is null or c.enriched_at < now() - make_interval(days => greatest(p_ttl_days, 1)))
   order by (not c.is_listed and c.synced_at < now() - interval '120 days') desc,
            c.enriched_at asc nulls first, c.is_listed desc, c.popularity desc, c.id
   limit greatest(p_limit, 0)
$$;

revoke execute on function public.catalog_enrich_due(integer, integer) from public, anon, authenticated;
