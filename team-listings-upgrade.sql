-- Run once in Supabase SQL Editor before deploying v48.
-- Listings become team-shared. Leads and cases stay private in agent_states.
create extension if not exists pgcrypto;

create table if not exists public.team_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  listing jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;
grant execute on function public.is_admin() to authenticated;

alter table public.team_listings enable row level security;
grant select, insert, update, delete on public.team_listings to authenticated;

drop policy if exists "members read team listings" on public.team_listings;
create policy "members read team listings" on public.team_listings for select to authenticated
  using (true);
drop policy if exists "members create own listings" on public.team_listings;
create policy "members create own listings" on public.team_listings for insert to authenticated
  with check (auth.uid() = owner_id);
drop policy if exists "owners or admins update listings" on public.team_listings;
create policy "owners or admins update listings" on public.team_listings for update to authenticated
  using (auth.uid() = owner_id or public.is_admin())
  with check (auth.uid() = owner_id or public.is_admin());
drop policy if exists "owners or admins delete listings" on public.team_listings;
create policy "owners or admins delete listings" on public.team_listings for delete to authenticated
  using (auth.uid() = owner_id or public.is_admin());

insert into public.team_listings(owner_id,listing,created_at,updated_at)
select s.user_id,
       (item - 'id' - '_ownerId') ||
         jsonb_build_object('_legacyOwner',s.user_id,'_legacyId',item->>'id'),
       s.updated_at,
       s.updated_at
from public.agent_states s
cross join lateral jsonb_array_elements(coalesce(s.data->'listings','[]'::jsonb)) item
where not exists (
  select 1 from public.team_listings t
  where t.listing->>'_legacyOwner'=s.user_id::text
    and t.listing->>'_legacyId'=item->>'id'
);

create or replace function public.import_listing_with_api_key(raw_key text, listing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  owner uuid;
  new_id uuid := gen_random_uuid();
  clean_listing jsonb;
begin
  if raw_key is null or listing is null or jsonb_typeof(listing)<>'object' then
    raise exception 'Invalid API key or listing';
  end if;
  select user_id into owner from public.agent_api_keys
    where key_hash=digest(raw_key,'sha256');
  if owner is null then raise exception 'Invalid or revoked API key'; end if;

  clean_listing := (listing - 'id' - 'shareId' - '_ownerId') ||
    jsonb_build_object('shareId','','importedBy','OpenClaw','importedAt',now());
  insert into public.team_listings(id,owner_id,listing)
  values(new_id,owner,clean_listing);

  update public.agent_api_keys set last_used_at=now() where user_id=owner;
  return jsonb_build_object('listing_id',new_id);
end;
$$;

revoke all on function public.import_listing_with_api_key(text,jsonb) from public;
grant execute on function public.import_listing_with_api_key(text,jsonb) to anon, authenticated;

create or replace function public.get_admin_agents()
returns table (
  user_id uuid,
  email text,
  name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  updated_at timestamptz,
  lead_count integer,
  listing_count integer,
  case_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text,
         coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email::text, '@', 1)),
         u.created_at, u.last_sign_in_at, s.updated_at,
         coalesce(jsonb_array_length(coalesce(s.data -> 'leads', '[]'::jsonb)), 0),
         coalesce((select count(*)::integer from public.team_listings t where t.owner_id=u.id), 0),
         coalesce(jsonb_array_length(coalesce(s.data -> 'cases', '[]'::jsonb)), 0)
  from auth.users u
  left join public.agent_states s on s.user_id = u.id
  order by u.created_at desc;
end;
$$;

create or replace function public.get_admin_agent_state(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select coalesce(data, '{"updatedAt":0,"leads":[],"listings":[],"cases":[]}'::jsonb) ||
         jsonb_build_object('listings',coalesce((
           select jsonb_agg(t.listing || jsonb_build_object(
             'id',t.id,'_ownerId',t.owner_id,'_createdAt',t.created_at
           ) order by t.created_at desc)
           from public.team_listings t where t.owner_id=target_user_id
         ),'[]'::jsonb))
    into result
    from public.agent_states
   where user_id = target_user_id;
  return coalesce(result, '{"updatedAt":0,"leads":[],"listings":[],"cases":[]}'::jsonb);
end;
$$;

revoke all on function public.get_admin_agents() from public;
revoke all on function public.get_admin_agent_state(uuid) from public;
grant execute on function public.get_admin_agents() to authenticated;
grant execute on function public.get_admin_agent_state(uuid) to authenticated;
