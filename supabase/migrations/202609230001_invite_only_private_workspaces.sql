-- Apply after the existing setup/migrations, before deploying the member UI.
-- Existing records are preserved. Only existing admins and email-invited users
-- start active; other existing accounts require approval in Members.
begin;

do $$ begin
  if not exists (select 1 from public.admin_users) then
    raise exception 'Configure the owner in admin_users before this migration';
  end if;
end $$;

create table if not exists public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  updated_at timestamptz not null default now()
);
alter table public.workspace_members enable row level security;
alter table public.admin_users enable row level security;
revoke all on public.workspace_members, public.admin_users from public, anon, authenticated;
grant all on public.workspace_members, public.admin_users to service_role;

insert into public.workspace_members(user_id,status)
select u.id, case when a.user_id is not null or u.invited_at is not null then 'active' else 'pending' end
from auth.users u left join public.admin_users a on a.user_id=u.id
on conflict(user_id) do nothing;

create or replace function public.is_workspace_member()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.workspace_members where user_id=auth.uid() and status='active') $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select public.is_workspace_member() and exists(select 1 from public.admin_users where user_id=auth.uid()) $$;

create or replace function public.get_workspace_membership()
returns jsonb language sql stable security definer set search_path=''
as $$ select jsonb_build_object('status',coalesce((select status from public.workspace_members where user_id=auth.uid()),'pending'),
  'role',case when public.is_admin() then 'admin' else 'member' end) $$;

-- Auth marks real invitations in invited_at; user-editable metadata is never
-- accepted as proof of invitation or as a source of account roles.
create or replace function public.register_invited_workspace_member()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if new.invited_at is null then
    raise exception 'This workspace is invite only' using errcode='42501';
  end if;
  insert into public.workspace_members(user_id,status) values(new.id,'active');
  return new;
end $$;
drop trigger if exists register_invited_workspace_member on auth.users;
create trigger register_invited_workspace_member after insert on auth.users
for each row execute function public.register_invited_workspace_member();

-- Remove security-definer escape routes into another agent's private data.
drop function if exists public.get_admin_agent_state(uuid);
drop function if exists public.get_admin_agents();
create or replace function public.get_workspace_accounts()
returns table(user_id uuid,email text,name text,created_at timestamptz,last_sign_in_at timestamptz,
  status text,role text,invitation_pending boolean)
language plpgsql security definer set search_path=''
as $$ begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  return query select u.id,u.email::text,
    coalesce(u.raw_user_meta_data->>'name',split_part(u.email::text,'@',1)),u.created_at,u.last_sign_in_at,
    m.status,case when a.user_id is null then 'member' else 'admin' end,
    u.invited_at is not null and u.email_confirmed_at is null
  from public.workspace_members m join auth.users u on u.id=m.user_id
  left join public.admin_users a on a.user_id=u.id order by u.created_at desc;
end $$;

create or replace function public.set_workspace_member_status(target_user_id uuid,new_status text)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if new_status not in ('active','suspended') or new_status is null then raise exception 'Invalid status'; end if;
  if target_user_id=auth.uid() or exists(select 1 from public.admin_users where user_id=target_user_id) then
    raise exception 'Administrator accounts cannot be changed here' using errcode='42501';
  end if;
  update public.workspace_members set status=new_status,updated_at=now() where user_id=target_user_id;
  if not found then raise exception 'Member not found'; end if;
  if new_status='suspended' then delete from public.agent_api_keys where user_id=target_user_id; end if;
end $$;

-- Restrictive policies also constrain any older permissive policies.
alter table public.agent_states enable row level security;
alter table public.team_listings enable row level security;
alter table public.public_shares enable row level security;
revoke all on public.agent_states from public,anon,authenticated;
grant select,insert,update,delete on public.agent_states to authenticated;
revoke all on public.agent_api_keys from public,anon,authenticated;
revoke all on public.team_listings,public.public_shares from public,anon,authenticated;
grant select on public.team_listings,public.public_shares to anon;
grant select,insert,update,delete on public.team_listings,public.public_shares to authenticated;
drop policy if exists workspace_private_state on public.agent_states;
create policy workspace_private_state on public.agent_states as restrictive for all to authenticated
using (public.is_workspace_member() and user_id=auth.uid())
with check (public.is_workspace_member() and user_id=auth.uid());
drop policy if exists workspace_listing_members on public.team_listings;
create policy workspace_listing_members on public.team_listings as restrictive for all to authenticated
using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists workspace_listing_insert_owner on public.team_listings;
create policy workspace_listing_insert_owner on public.team_listings as restrictive for insert to authenticated
with check (owner_id=auth.uid());
drop policy if exists workspace_listing_update_owner on public.team_listings;
create policy workspace_listing_update_owner on public.team_listings as restrictive for update to authenticated
using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists workspace_listing_delete_owner on public.team_listings;
create policy workspace_listing_delete_owner on public.team_listings as restrictive for delete to authenticated
using (owner_id=auth.uid());
drop policy if exists workspace_share_members on public.public_shares;
create policy workspace_share_members on public.public_shares as restrictive for all to authenticated
using (public.is_workspace_member()) with check (public.is_workspace_member() and owner_id=auth.uid());

-- Security-definer API-key functions must not recreate keys after suspension.
create or replace function public.check_api_key_member()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  perform 1 from public.workspace_members where user_id=new.user_id and status='active' for share;
  if not found then raise exception 'Active membership required' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists check_api_key_member on public.agent_api_keys;
create trigger check_api_key_member before insert or update on public.agent_api_keys
for each row execute function public.check_api_key_member();

revoke all on function public.is_workspace_member(),public.is_admin(),public.get_workspace_membership(),
  public.get_workspace_accounts(),public.set_workspace_member_status(uuid,text),
  public.register_invited_workspace_member(),public.check_api_key_member() from public,anon,authenticated;
grant execute on function public.is_workspace_member(),public.is_admin(),public.get_workspace_membership(),
  public.get_workspace_accounts(),public.set_workspace_member_status(uuid,text) to authenticated;

-- Serialize key imports against suspension; no stale key can publish afterward.
create or replace function public.import_listing_with_api_key(raw_key text,listing jsonb)
returns jsonb language plpgsql security definer set search_path='public','extensions'
as $$ declare owner uuid; new_id uuid:=gen_random_uuid(); clean_listing jsonb;
begin
  if raw_key is null or listing is null or jsonb_typeof(listing)<>'object' then
    raise exception 'Invalid API key or listing'; end if;
  select k.user_id into owner from public.agent_api_keys k
    join public.workspace_members m on m.user_id=k.user_id
    where k.key_hash=digest(raw_key,'sha256') and k.revoked_at is null and m.status='active'
    for share of m,k;
  if owner is null then raise exception 'Invalid or revoked API key'; end if;
  clean_listing := (listing-'id'-'shareId'-'_ownerId') ||
    jsonb_build_object('shareId','','importedBy','OpenClaw','importedAt',now());
  insert into public.team_listings(id,owner_id,listing) values(new_id,owner,clean_listing);
  update public.agent_api_keys set last_used_at=now() where user_id=owner;
  return jsonb_build_object('listing_id',new_id);
end $$;

commit;
