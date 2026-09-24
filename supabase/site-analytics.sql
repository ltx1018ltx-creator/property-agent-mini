-- Public landing-page measurements; reports are owner-only. No personal fields.
begin;
create table public.site_analytics_events (
  event_id uuid primary key,
  visit_id uuid not null,
  recorded_at timestamptz not null default now(),
  event_name text not null check(event_name in ('page_view','listing_view','whatsapp_click')),
  listing_id text not null default '' check(length(listing_id)<=100),
  listing_title text not null default '' check(length(listing_title)<=160),
  device_type text not null check(device_type in ('Mobile','Tablet','Desktop')),
  source_category text not null check(source_category in ('Direct','Facebook / Instagram','Google','Other'))
);
create index site_analytics_recorded on public.site_analytics_events(recorded_at);
create index site_analytics_visit on public.site_analytics_events(visit_id,recorded_at);
alter table public.site_analytics_events enable row level security;
revoke all on public.site_analytics_events from public,anon,authenticated;
grant all on public.site_analytics_events to service_role;

create function public.record_site_event(event_id uuid,visit_id uuid,event_name text,
  listing_id text default '',listing_title text default '',device_type text default 'Desktop',source_category text default 'Direct')
returns void language plpgsql security definer set search_path=''
as $$ declare headers jsonb; day_start timestamptz:=date_trunc('day',now());
begin
  headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  -- Origin filtering reduces accidental contamination, not proof of a human visit.
  if headers->>'origin' is distinct from 'https://mari-property-melaka.txleong1998596286.chatgpt.site' then return; end if;
  if event_id is null or visit_id is null or event_name is null or event_name not in ('page_view','listing_view','whatsapp_click') then return; end if;
  if device_type is null or device_type not in ('Mobile','Tablet','Desktop') or source_category is null or source_category not in ('Direct','Facebook / Instagram','Google','Other') then return; end if;
  if listing_id is null or listing_title is null or length(listing_id)>100 or length(listing_title)>160 or listing_id !~ '^[a-zA-Z0-9_-]*$' then return; end if;
  if event_name='listing_view' and listing_id='' then return; end if;
  perform pg_advisory_xact_lock(73194,924);
  if (select count(*) from public.site_analytics_events e where e.recorded_at>=day_start)>=30000 then return; end if;
  if (select count(*) from public.site_analytics_events e where e.visit_id=record_site_event.visit_id and e.recorded_at>=day_start)>=300 then return; end if;
  insert into public.site_analytics_events(event_id,visit_id,event_name,listing_id,listing_title,device_type,source_category)
    values(event_id,visit_id,event_name,listing_id,listing_title,device_type,source_category) on conflict do nothing;
end $$;
revoke all on function public.record_site_event(uuid,uuid,text,text,text,text,text) from public;
grant execute on function public.record_site_event(uuid,uuid,text,text,text,text,text) to anon,authenticated;

create function public.get_site_analytics(days integer default 7)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; start_date date; report jsonb;
begin
  if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then
    raise exception 'Owner access required' using errcode='42501'; end if;
  if days is null or days not in (7,30,90) then raise exception 'Choose 7, 30 or 90 days'; end if;
  start_date:=today-(days-1);
  with e as materialized (
    select * from public.site_analytics_events where recorded_at>=start_date::timestamp at time zone 'Asia/Kuala_Lumpur'
      and recorded_at<(today+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  ), daily as (
    select (recorded_at at time zone 'Asia/Kuala_Lumpur')::date as event_day,count(*) filter(where event_name='page_view') views,
      count(*) filter(where event_name='whatsapp_click') enquiries from e group by 1
  ) select jsonb_build_object(
    'generated_at',now(),'days',days,'timezone','Asia/Kuala_Lumpur',
    'started_at',(select min(recorded_at) from public.site_analytics_events),
    'sessions',(select count(distinct visit_id) from e),'page_views',(select count(*) from e where event_name='page_view'),
    'listing_views',(select count(*) from e where event_name='listing_view'),
    'whatsapp_clicks',(select count(*) from e where event_name='whatsapp_click'),
    'daily',(select jsonb_agg(jsonb_build_object('day',d::date,'views',coalesce(a.views,0),'enquiries',coalesce(a.enquiries,0)) order by d)
      from generate_series(start_date::timestamp,today::timestamp,interval '1 day') d left join daily a on a.event_day=d::date),
    'listings',coalesce((select jsonb_agg(row_to_json(t)) from (
      select listing_id,max(listing_title) title,count(*) filter(where event_name='listing_view') views,
        count(*) filter(where event_name='whatsapp_click') enquiries from e where listing_id<>''
      group by listing_id order by views desc,enquiries desc,listing_id limit 10) t),'[]'::jsonb),
    'devices',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select device_type label,count(distinct visit_id) visits from e group by device_type order by visits desc) t),
    'sources',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select source_category label,count(distinct visit_id) visits from e group by source_category order by visits desc) t)
  ) into report;
  return report;
end $$;
revoke all on function public.get_site_analytics(integer) from public,anon,authenticated;
grant execute on function public.get_site_analytics(integer) to authenticated;
commit;
