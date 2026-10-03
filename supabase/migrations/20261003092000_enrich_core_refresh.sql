-- =============================================================================
-- Stubbed: refresh referenced unlisted rows (ADR-013 C-06, AR-8; TMDB "cache <= 6 months" rule).
-- New file. Amends ADR-002 §4: referenced unlisted rows are re-synced at most every 120 days via enrich.
--   * catalog_set_enrichment(p_rows): same signature; an optional `core` object per row updates the
--     catalogue fields ONLY on unlisted rows (discover owns listed rows) and stamps synced_at. It never
--     sets is_listed and never touches pitch_hook.
--   * catalog_enrich_due: stale unlisted rows (synced_at > 120 days) go first within the budget; it now
--     also returns is_listed (sync_runs.counts.enrich.unlisted_refreshed).
--   * catalog_mark_gone(p_ids): TMDB detail 404 → source_status = 'gone' (job only).
-- =============================================================================

create or replace function public.catalog_set_enrichment(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.catalog_index c set
    imdb_id             = coalesce(r.imdb_id, c.imdb_id),
    imdb_rating         = case when coalesce(r.imdb_id, c.imdb_id) is distinct from c.imdb_id then null else c.imdb_rating end,
    imdb_votes          = case when coalesce(r.imdb_id, c.imdb_id) is distinct from c.imdb_id then null else c.imdb_votes end,
    imdb_checked_at     = case when coalesce(r.imdb_id, c.imdb_id) is distinct from c.imdb_id then null else c.imdb_checked_at end,
    runtime_minutes     = r.runtime_minutes,
    season_count        = r.season_count,
    episode_count       = r.episode_count,
    episode_runtime     = r.episode_runtime,
    series_status       = r.series_status,
    tagline             = nullif(r.tagline, ''),
    certification       = nullif(r.certification, ''),
    keywords            = coalesce(r.keywords, '{}'),
    recommendation_keys = coalesce(r.recommendation_keys, '{}'),
    enriched_at         = now(),
    -- v1.6 core refresh: unlisted rows only.
    title          = case when k.ok then coalesce(nullif(r.core->>'title', ''), c.title) else c.title end,
    original_title = case when k.ok then coalesce(nullif(r.core->>'original_title', ''), c.original_title) else c.original_title end,
    slug           = case when k.ok then coalesce(nullif(r.core->>'slug', ''), c.slug) else c.slug end,
    sort_title     = case when k.ok then coalesce(nullif(r.core->>'sort_title', ''), c.sort_title) else c.sort_title end,
    search_text    = case when k.ok then coalesce(nullif(r.core->>'search_text', ''), c.search_text) else c.search_text end,
    overview_short = case when k.ok then left(coalesce(r.core->>'overview_short', c.overview_short), 300) else c.overview_short end,
    release_date   = case when k.ok and (r.core ? 'release_date') then nullif(r.core->>'release_date', '')::date else c.release_date end,
    vote_average   = case when k.ok and jsonb_typeof(r.core->'vote_average') = 'number'
                          then least(greatest(round((r.core->>'vote_average')::numeric, 1), 0), 10) else c.vote_average end,
    vote_count     = case when k.ok and jsonb_typeof(r.core->'vote_count') = 'number'
                          then greatest((r.core->>'vote_count')::numeric::integer, 0) else c.vote_count end,
    popularity     = case when k.ok and jsonb_typeof(r.core->'popularity') = 'number'
                          then (r.core->>'popularity')::real else c.popularity end,
    poster_path    = case when k.ok and (r.core ? 'poster_path') then nullif(r.core->>'poster_path', '') else c.poster_path end,
    backdrop_path  = case when k.ok and (r.core ? 'backdrop_path') then nullif(r.core->>'backdrop_path', '') else c.backdrop_path end,
    genre_ids      = case when k.ok and jsonb_typeof(r.core->'genre_ids') = 'array'
                          then array(select x::integer from jsonb_array_elements_text(r.core->'genre_ids') x where x ~ '^[0-9]{1,9}$')
                          else c.genre_ids end,
    genres         = case when k.ok and jsonb_typeof(r.core->'genres') = 'array' then r.core->'genres' else c.genres end,
    synced_at      = case when k.ok then now() else c.synced_at end
  from jsonb_to_recordset(p_rows) as r(
    id bigint, imdb_id text, runtime_minutes smallint, season_count smallint, episode_count smallint,
    episode_runtime smallint, series_status text, tagline text, certification text, keywords text[],
    recommendation_keys text[], core jsonb),
  lateral (select (jsonb_typeof(r.core) = 'object') as core_given) g,
  lateral (select coalesce(g.core_given, false) and not (select x.is_listed from public.catalog_index x where x.id = r.id) as ok) k
  where c.id = r.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Return type gains is_listed (the job counts unlisted refreshes) → drop + create, same arguments.
drop function if exists public.catalog_enrich_due(integer, integer);

create function public.catalog_enrich_due(p_limit integer, p_ttl_days integer default 30)
returns table (id bigint, media_type text, tmdb_id integer, is_listed boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.media_type, c.tmdb_id, c.is_listed from public.catalog_index c
   where c.enriched_at is null or c.enriched_at < now() - make_interval(days => greatest(p_ttl_days, 1))
   order by (not c.is_listed and c.synced_at < now() - interval '120 days') desc,
            c.enriched_at asc nulls first, c.is_listed desc, c.popularity desc, c.id
   limit greatest(p_limit, 0)
$$;

create or replace function public.catalog_mark_gone(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.catalog_index set source_status = 'gone'
   where id = any(coalesce(p_ids, '{}')) and source_status <> 'gone';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.catalog_set_enrichment(jsonb) from public, anon, authenticated;
revoke execute on function public.catalog_enrich_due(integer, integer) from public, anon, authenticated;
revoke execute on function public.catalog_mark_gone(bigint[]) from public, anon, authenticated;
