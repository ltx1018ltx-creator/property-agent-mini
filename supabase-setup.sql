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

alter table public.agent_states enable row level security;
alter table public.public_shares enable row level security;

grant select, insert, update, delete on public.agent_states to authenticated;
grant select on public.public_shares to anon;
grant select, insert, delete on public.public_shares to authenticated;

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
