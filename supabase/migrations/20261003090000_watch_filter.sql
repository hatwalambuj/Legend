-- =============================================================================
-- Stubbed: browse "On {Service}" filter + chips (ADR-013 C-02, API_CONTRACT v1.6 §5.3/§5.23).
-- New file; never edit an applied migration.
--   * catalog_page / catalog_count recreated with `p_watch_tag text default null` ('US:8'): listed rows
--     whose stream/free/ads list in that region has the provider AND whose watch data is <= 30 days old.
--     Dropped first so there is no overload (PostgREST must resolve one function per name).
--   * watch_provider_counts(p_region): top 6 providers by TMDB priority in the region with >= 1 such row.
-- The GIN index catalog_watch_tags (… where is_listed) already exists (20260928120000_where_to_watch.sql).
-- =============================================================================

drop function if exists public.catalog_page(text, text, jsonb, integer, integer[]);
drop function if exists public.catalog_count(text, integer[]);

create function public.catalog_page(
  p_type      text,
  p_sort      text,
  p_after     jsonb default null,
  p_limit     integer default 20,
  p_genre_ids integer[] default null,
  p_watch_tag text default null
) returns setof public.catalog_index
language plpgsql stable security invoker set search_path = public as $$
declare
  v_order text;
  v_after text;
begin
  if p_type not in ('all', 'movie', 'tv') then raise exception 'invalid_type' using errcode = '22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 51 then raise exception 'invalid_limit' using errcode = '22023'; end if;
  if p_watch_tag is not null and p_watch_tag !~ '^[A-Z]{2}:[1-9][0-9]{0,9}$' then
    raise exception 'invalid_watch_tag' using errcode = '22023';
  end if;

  case p_sort
    when 'release_desc' then
      v_order := 'c.release_date desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.release_date < ($1->>0)::date
        or (c.release_date = ($1->>0)::date and (c.sort_title > ($1->>1)
        or (c.sort_title = ($1->>1) and c.title_key > ($1->>2)))))$k$;
    when 'release_asc' then
      v_order := 'c.release_date asc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.release_date > ($1->>0)::date
        or (c.release_date = ($1->>0)::date and (c.sort_title > ($1->>1)
        or (c.sort_title = ($1->>1) and c.title_key > ($1->>2)))))$k$;
    when 'rating_desc' then
      v_order := 'c.vote_average desc, c.vote_count desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.vote_average < ($1->>0)::numeric
        or (c.vote_average = ($1->>0)::numeric and (c.vote_count < ($1->>1)::int
        or (c.vote_count = ($1->>1)::int and (c.sort_title > ($1->>2)
        or (c.sort_title = ($1->>2) and c.title_key > ($1->>3)))))))$k$;
    when 'rating_asc' then
      v_order := 'c.vote_average asc, c.vote_count desc, c.sort_title asc, c.title_key asc';
      v_after := $k$(c.vote_average > ($1->>0)::numeric
        or (c.vote_average = ($1->>0)::numeric and (c.vote_count < ($1->>1)::int
        or (c.vote_count = ($1->>1)::int and (c.sort_title > ($1->>2)
        or (c.sort_title = ($1->>2) and c.title_key > ($1->>3)))))))$k$;
    when 'popularity_desc' then
      v_order := 'c.popularity desc, c.title_key asc';
      v_after := $k$(c.popularity < ($1->>0)::real
        or (c.popularity = ($1->>0)::real and c.title_key > ($1->>1)))$k$;
    else
      raise exception 'invalid_sort' using errcode = '22023';
  end case;

  return query execute format(
    'select c.* from public.catalog_index c
      where c.is_listed
        and ($2 = ''all'' or c.media_type = $2)
        and ($4::int[] is null or c.genre_ids && $4)
        and ($5::text is null or (c.watch_tags @> array[$5::text]
             and c.watch_checked_at >= now() - interval ''30 days''))
        and ($1 is null or %s)
      order by %s
      limit $3', v_after, v_order)
  using p_after, p_type, p_limit, p_genre_ids, p_watch_tag;
end $$;

create function public.catalog_count(
  p_type text,
  p_genre_ids integer[] default null,
  p_watch_tag text default null
) returns bigint language sql stable security invoker set search_path = public as $$
  select count(*) from public.catalog_index c
   where c.is_listed and (p_type = 'all' or c.media_type = p_type)
     and (p_genre_ids is null or c.genre_ids && p_genre_ids)
     and (p_watch_tag is null or (c.watch_tags @> array[p_watch_tag]
          and c.watch_checked_at >= now() - interval '30 days'))
$$;

-- Browse chips (W-31/32): listed rows with fresh data per provider tag of the region; top 6 by the
-- provider's TMDB display priority in that region (unknown priority last), count >= 1.
create function public.watch_provider_counts(p_region text)
returns table (provider_id integer, name text, logo_path text, priority integer, count integer)
language sql stable security invoker set search_path = public as $$
  with tagged as (
    select split_part(t.tag, ':', 2)::integer as provider_id, count(*)::integer as n
      from public.catalog_index c
      cross join lateral unnest(c.watch_tags) as t(tag)
     where p_region ~ '^[A-Z]{2}$'
       and c.is_listed
       and c.watch_checked_at >= now() - interval '30 days'
       and t.tag like p_region || ':%'
     group by 1
  )
  select w.provider_id, w.name, w.logo_path,
         case when (w.priorities ->> p_region) ~ '^[0-9]{1,6}$' then (w.priorities ->> p_region)::integer end,
         k.n
    from tagged k
    join public.watch_provider w on w.provider_id = k.provider_id
   where k.n >= 1
   order by 4 asc nulls last, k.n desc, w.provider_id
   limit 6
$$;

grant execute on function public.catalog_page(text, text, jsonb, integer, integer[], text) to anon, authenticated;
grant execute on function public.catalog_count(text, integer[], text) to anon, authenticated;
grant execute on function public.watch_provider_counts(text) to anon, authenticated;
