-- =============================================================================
-- Stubbed: avatar colour (ADR-013 C-12, B3-AC2). New file. null = the handle-derived colour.
-- =============================================================================

alter table public.profiles add column avatar_color text
  check (avatar_color is null or avatar_color in ('sunset','ocean','forest','grape','ember','steel','rose','gold'));

-- Column grants: the handle stays immutable.
grant update (display_name, bio, avatar_url, avatar_color) on public.profiles to authenticated;

-- Same columns and types; the author object gains avatarColor.
create or replace view public.review_details with (security_invoker = true) as
  select r.id, r.user_id, r.title_id, c.title_key, r.rating_10, r.body, r.is_spoiler, r.stub_id,
         (select sd.number from public.stub_details sd where sd.id = r.stub_id) as stub_number,
         r.created_at, r.updated_at, r.edited_at,
         jsonb_build_object('id', p.id, 'handle', p.handle::text, 'displayName', p.display_name,
                            'bio', p.bio, 'avatarUrl', p.avatar_url, 'createdAt', p.created_at,
                            'avatarColor', p.avatar_color) as author
    from public.reviews r
    join public.catalog_index c on c.id = r.title_id
    join public.profiles p on p.id = r.user_id;
