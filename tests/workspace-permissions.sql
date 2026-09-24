-- Run in Supabase SQL Editor after the migration. Everything rolls back.
-- Tests use synthetic identities and never read existing members' private rows.
begin;
select set_config('test.users',jsonb_build_array(
  jsonb_build_object('label','admin','id',gen_random_uuid()),
  jsonb_build_object('label','alice','id',gen_random_uuid()),
  jsonb_build_object('label','bob','id',gen_random_uuid()))::text,true);
insert into auth.users(id,email,aud,role,invited_at,email_confirmed_at)
select id,id::text||'@example.invalid','authenticated','authenticated',now(),now() from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid);
insert into public.admin_users(user_id) select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='admin';
insert into public.agent_states(user_id,data)
select id,jsonb_build_object('leads',jsonb_build_array(jsonb_build_object('name',label||' private client')),'cases','[]'::jsonb)
from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid);
insert into public.team_listings(owner_id,listing)
select id,jsonb_build_object('title',label||' shared listing') from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid);

set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='admin'),true);
do $$ begin
  if not public.is_admin() then raise exception 'Admin role missing'; end if;
  if (select count(*) from public.agent_states where user_id in(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid)))<>1 then
    raise exception 'Admin can read another private workspace'; end if;
  if to_regprocedure('public.get_admin_agent_state(uuid)') is not null then raise exception 'Legacy private-state RPC remains'; end if;
  if (select count(*) from public.get_workspace_accounts() where user_id in(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid)))<>3 then
    raise exception 'Account management unavailable'; end if;
  update public.agent_states set data='{}' where user_id=(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='alice');
  if found then raise exception 'Admin can modify another private workspace'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select id::text from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='alice'),true);
do $$ begin
  if public.is_admin() then raise exception 'Member gained admin'; end if;
  if (select count(*) from public.agent_states where user_id in(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid)))<>1 then
    raise exception 'Member private isolation failed'; end if;
  if (select count(*) from public.team_listings where owner_id in(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid)))<>3 then
    raise exception 'Shared listing access failed'; end if;
  update public.team_listings set listing='{}' where owner_id=(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='bob');
  if found then raise exception 'Member modified another listing'; end if;
  update public.team_listings set listing=listing||'{"checked":true}' where owner_id=auth.uid();
  if not found then raise exception 'Owner cannot edit own listing'; end if;
  begin
    perform public.get_workspace_accounts();
    raise exception 'Member can list accounts';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_workspace_member_status((select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='bob'),'suspended');
    raise exception 'Member can manage accounts';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.agent_states(user_id,data) values((select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='bob'),'{}')
    on conflict(user_id) do update set data=excluded.data;
    raise exception 'Cross-member write allowed';
  exception when insufficient_privilege then null; end;
  perform public.create_agent_api_key();
end $$;

select set_config('request.jwt.claim.sub',(select id::text from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='admin'),true);
select public.set_workspace_member_status((select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='alice'),'suspended');
select set_config('request.jwt.claim.sub',(select id::text from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='alice'),true);
do $$ begin
  if public.is_workspace_member() then raise exception 'Suspended member remains active'; end if;
  if exists(select 1 from public.agent_states) or exists(select 1 from public.team_listings) then
    raise exception 'Suspended member can read workspace'; end if;
  begin
    perform public.create_agent_api_key();
    raise exception 'Suspended member can recreate API key';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  if exists(select 1 from public.agent_api_keys where user_id=(select id from jsonb_to_recordset(current_setting('test.users')::jsonb) as fixture(label text,id uuid) where label='alice')) then
    raise exception 'Suspension did not revoke API key'; end if;
  begin
    insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'uninvited@example.invalid','{"role":"admin","invited":true}');
    raise exception 'Self-registration or metadata spoofing allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
