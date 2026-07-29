-- Run once in Supabase: SQL Editor > New query > Run
create table if not exists public.agent_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"updatedAt":0,"leads":[],"listings":[],"cases":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.public_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create extension if not exists pgcrypto;

create table if not exists public.agent_api_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key_hash bytea not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- CREATE TABLE IF NOT EXISTS does not add new columns to an older table.
-- Keep upgrades rerunnable when agent_api_keys already exists.
alter table public.agent_api_keys
  add column if not exists last_used_at timestamptz;

alter table public.agent_states enable row level security;
alter table public.public_shares enable row level security;
alter table public.agent_api_keys enable row level security;

grant select, insert, update, delete on public.agent_states to authenticated;
grant select on public.public_shares to anon;
grant select, insert, delete on public.public_shares to authenticated;

-- API keys are managed only through the security-definer functions below.
revoke all on public.agent_api_keys from anon, authenticated;

drop policy if exists "own state only" on public.agent_states;
create policy "own state only" on public.agent_states for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner creates shares" on public.public_shares;
create policy "owner creates shares" on public.public_shares for insert to authenticated
  with check (auth.uid() = owner_id);
drop policy if exists "public reads shares" on public.public_shares;
create policy "public reads shares" on public.public_shares for select to anon, authenticated
  using (true);
drop policy if exists "owner deletes shares" on public.public_shares;
create policy "owner deletes shares" on public.public_shares for delete to authenticated
  using (auth.uid() = owner_id);

create or replace function public.create_agent_api_key()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  raw_key := 'mari_' || encode(gen_random_bytes(32), 'hex');
  insert into public.agent_api_keys(user_id,key_hash,key_prefix,created_at,last_used_at)
  values(auth.uid(),digest(raw_key,'sha256'),left(raw_key,13),now(),null)
  on conflict(user_id) do update set
    key_hash=excluded.key_hash,key_prefix=excluded.key_prefix,
    created_at=excluded.created_at,last_used_at=null;
  return jsonb_build_object('api_key',raw_key,'key_prefix',left(raw_key,13),'created_at',now());
end;
$$;

-- PostgreSQL cannot change an existing function's return type with
-- CREATE OR REPLACE. Drop the older version first so this setup remains rerunnable.
drop function if exists public.revoke_agent_api_key();
create function public.revoke_agent_api_key()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.agent_api_keys where user_id=auth.uid();
$$;

create or replace function public.get_agent_api_key_status()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select jsonb_build_object(
      'active',true,'key_prefix',key_prefix,
      'created_at',created_at,'last_used_at',last_used_at
    ) from public.agent_api_keys where user_id=auth.uid()),
    '{"active":false}'::jsonb
  );
$$;

create or replace function public.import_listing_with_api_key(raw_key text, listing jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  owner uuid;
  new_id bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  clean_listing jsonb;
begin
  if raw_key is null or listing is null or jsonb_typeof(listing)<>'object' then
    raise exception 'Invalid API key or listing';
  end if;
  select user_id into owner from public.agent_api_keys
    where key_hash=digest(raw_key,'sha256');
  if owner is null then raise exception 'Invalid or revoked API key'; end if;

  clean_listing := (listing - 'id' - 'shareId') ||
    jsonb_build_object('id',new_id,'shareId','','importedBy','OpenClaw','importedAt',now());

  insert into public.agent_states(user_id,data,updated_at)
  values(owner,jsonb_build_object(
    'updatedAt',new_id,'leads','[]'::jsonb,
    'listings',jsonb_build_array(clean_listing),'cases','[]'::jsonb
  ),now())
  on conflict(user_id) do update set
    data=jsonb_set(
      jsonb_set(agent_states.data,'{listings}',
        jsonb_build_array(clean_listing) || coalesce(agent_states.data->'listings','[]'::jsonb),true),
      '{updatedAt}',to_jsonb(new_id),true
    ),
    updated_at=now();

  update public.agent_api_keys set last_used_at=now() where user_id=owner;
  return jsonb_build_object('listing_id',new_id);
end;
$$;

revoke all on function public.create_agent_api_key() from public;
revoke all on function public.revoke_agent_api_key() from public;
revoke all on function public.get_agent_api_key_status() from public;
revoke all on function public.import_listing_with_api_key(text,jsonb) from public;
grant execute on function public.create_agent_api_key() to authenticated;
grant execute on function public.revoke_agent_api_key() to authenticated;
grant execute on function public.get_agent_api_key_status() to authenticated;
grant execute on function public.import_listing_with_api_key(text,jsonb) to anon, authenticated;
