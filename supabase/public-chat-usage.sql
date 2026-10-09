-- Only aggregate counts and a daily rotating HMAC network key; no chat transcripts.
create table public.public_chat_usage (
  bucket text primary key,
  used integer not null default 0 check (used >= 0),
  expires_at timestamptz not null
);
alter table public.public_chat_usage enable row level security;
revoke all on public.public_chat_usage from public, anon, authenticated;
grant select, insert, update, delete on public.public_chat_usage to service_role;

create function public.reserve_public_chat(network_hash text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  now_at timestamptz := clock_timestamp();
  day_key text := to_char(now_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD');
  month_key text := to_char(now_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM');
  minute_key text := to_char(now_at at time zone 'UTC','YYYY-MM-DD-HH24-MI');
  keys text[];
  caps integer[] := array[3000,200,12,30,4];
  i integer;
begin
  if network_hash is null or network_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid bucket'; end if;
  -- Shared lock makes simultaneous global/network reservations atomic.
  perform pg_advisory_xact_lock(19091009);
  keys := array['month:'||month_key,'day:'||day_key,'minute:'||minute_key,
                'network-day:'||day_key||':'||network_hash,'network-minute:'||minute_key||':'||network_hash];
  delete from public.public_chat_usage where expires_at < now_at;
  for i in 1..5 loop
    if coalesce((select used from public.public_chat_usage where bucket=keys[i]),0) >= caps[i] then return false; end if;
  end loop;
  for i in 1..5 loop
    insert into public.public_chat_usage(bucket,used,expires_at)
    values(keys[i],1,now_at + case when i=1 then interval '32 days' when i in (2,4) then interval '2 days' else interval '2 minutes' end)
    on conflict(bucket) do update set used=public.public_chat_usage.used+1;
  end loop;
  return true;
end $$;
revoke all on function public.reserve_public_chat(text) from public,anon,authenticated;
grant execute on function public.reserve_public_chat(text) to service_role;

