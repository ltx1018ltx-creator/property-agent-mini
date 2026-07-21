-- Run once in Supabase SQL Editor. This adds read-only admin access.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

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
  select u.id,
         u.email::text,
         coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email::text, '@', 1)),
         u.created_at,
         u.last_sign_in_at,
         s.updated_at,
         coalesce(jsonb_array_length(coalesce(s.data -> 'leads', '[]'::jsonb)), 0),
         coalesce(jsonb_array_length(coalesce(s.data -> 'listings', '[]'::jsonb)), 0),
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

  select coalesce(data, '{"updatedAt":0,"leads":[],"listings":[],"cases":[]}'::jsonb)
    into result
    from public.agent_states
   where user_id = target_user_id;

  return coalesce(result, '{"updatedAt":0,"leads":[],"listings":[],"cases":[]}'::jsonb);
end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.get_admin_agents() from public;
revoke all on function public.get_admin_agent_state(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_admin_agents() to authenticated;
grant execute on function public.get_admin_agent_state(uuid) to authenticated;

-- Replace the email below with your own login email before running.
insert into public.admin_users (user_id)
select id from auth.users where lower(email) = lower('YOUR_LOGIN_EMAIL')
on conflict (user_id) do nothing;
