begin;
create table public.workspace_invite_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check(length(token_hash)=64),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null check(max_uses in (1,5,10)),
  revoked_at timestamptz
);
create table public.workspace_invite_requests (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.workspace_invite_links(id),
  email text not null check(length(email)<=254),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  completed_at timestamptz,
  user_id uuid references auth.users(id)
);
create index workspace_invite_request_link on public.workspace_invite_requests(invite_id,created_at);
alter table public.workspace_invite_links enable row level security;
alter table public.workspace_invite_requests enable row level security;
revoke all on public.workspace_invite_links,public.workspace_invite_requests from public,anon,authenticated;
grant all on public.workspace_invite_links,public.workspace_invite_requests to service_role;

create function public.create_workspace_invite_link(valid_days integer default 7,member_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare raw text; link public.workspace_invite_links;
begin
 if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then raise exception 'Owner access required' using errcode='42501'; end if;
 if valid_days is null or valid_days not in (1,7) or member_limit is null or member_limit not in (1,5,10) then raise exception 'Invalid invitation settings'; end if;
 raw:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.workspace_invite_links(token_hash,created_by,expires_at,max_uses)
 values(encode(extensions.digest(raw,'sha256'),'hex'),auth.uid(),now()+make_interval(days=>valid_days),member_limit) returning * into link;
 return jsonb_build_object('id',link.id,'token',raw,'expires_at',link.expires_at,'max_uses',member_limit);
end $$;

create function public.list_workspace_invite_links()
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
 if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then raise exception 'Owner access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row_to_json(t)) from (
   select l.id,l.created_at,l.expires_at,l.max_uses,l.revoked_at,
    (select count(*) from public.workspace_invite_requests r where r.invite_id=l.id and r.completed_at is not null) uses,
    (select count(*) from public.workspace_invite_requests r where r.invite_id=l.id and r.completed_at is null and r.released_at is null) processing
   from public.workspace_invite_links l where l.created_by=auth.uid() order by l.created_at desc limit 20
 ) t),'[]'::jsonb);
end $$;

create function public.revoke_workspace_invite_link(invitation_id uuid)
returns void language plpgsql security definer set search_path=''
as $$ begin
 if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then raise exception 'Owner access required' using errcode='42501'; end if;
 update public.workspace_invite_links set revoked_at=coalesce(revoked_at,now()) where id=invitation_id and created_by=auth.uid();
 if not found then raise exception 'Invitation not found'; end if;
end $$;

-- Service-only helpers: browsers never gain access to tokens or recipient records.
create function public.check_workspace_invite_link(raw_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare l public.workspace_invite_links; used integer;
begin
 if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('valid',false); end if;
 select * into l from public.workspace_invite_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex');
 if not found or l.revoked_at is not null or l.expires_at<=now() then return jsonb_build_object('valid',false); end if;
 select count(*) into used from public.workspace_invite_requests r where r.invite_id=l.id and r.released_at is null;
 return jsonb_build_object('valid',used<l.max_uses,'expires_at',l.expires_at);
end $$;

create function public.reserve_workspace_invite(raw_token text,recipient_email text)
returns uuid language plpgsql security definer set search_path=''
as $$ declare l public.workspace_invite_links; rid uuid; used integer;
begin
 if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' or recipient_email is null or length(recipient_email)>254 or recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invitation unavailable' using errcode='22023'; end if;
 select * into l from public.workspace_invite_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 if not found or l.revoked_at is not null or l.expires_at<=now() then raise exception 'Invitation unavailable' using errcode='22023'; end if;
 select count(*) into used from public.workspace_invite_requests r where r.invite_id=l.id and r.released_at is null;
 if used>=l.max_uses then raise exception 'Invitation unavailable' using errcode='22023'; end if;
 if exists(select 1 from public.workspace_invite_requests r where r.invite_id=l.id and r.email=lower(trim(recipient_email)) and r.released_at is null) then raise exception 'Invitation already requested' using errcode='22023'; end if;
 insert into public.workspace_invite_requests(invite_id,email) values(l.id,lower(trim(recipient_email))) returning id into rid;
 return rid;
end $$;

create function public.complete_workspace_invite(reservation_id uuid,invited_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$ declare r public.workspace_invite_requests;
begin
 select * into r from public.workspace_invite_requests where id=reservation_id for update;
 if not found or r.released_at is not null then raise exception 'Invitation reservation unavailable'; end if;
 if r.completed_at is not null then
   if r.user_id=invited_user_id then return; end if;
   raise exception 'Invitation already completed';
 end if;
 if not exists(select 1 from auth.users u join public.workspace_members m on m.user_id=u.id
   where u.id=invited_user_id and lower(u.email)=r.email and u.invited_at is not null and m.status='active')
   or exists(select 1 from public.admin_users where user_id=invited_user_id) then raise exception 'Invited member not found'; end if;
 update public.workspace_invite_requests set completed_at=now(),user_id=invited_user_id where id=reservation_id;
end $$;

create function public.release_workspace_invite(reservation_id uuid)
returns void language sql security definer set search_path=''
as $$ update public.workspace_invite_requests set released_at=now() where id=reservation_id and completed_at is null $$;

revoke all on function public.create_workspace_invite_link(integer,integer),public.list_workspace_invite_links(),public.revoke_workspace_invite_link(uuid),public.check_workspace_invite_link(text),public.reserve_workspace_invite(text,text),public.complete_workspace_invite(uuid,uuid),public.release_workspace_invite(uuid) from public,anon,authenticated;
grant execute on function public.create_workspace_invite_link(integer,integer),public.list_workspace_invite_links(),public.revoke_workspace_invite_link(uuid) to authenticated;
grant execute on function public.check_workspace_invite_link(text),public.reserve_workspace_invite(text,text),public.complete_workspace_invite(uuid,uuid),public.release_workspace_invite(uuid) to service_role;
commit;
