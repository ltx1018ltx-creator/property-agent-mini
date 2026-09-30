-- Public, bounded campaign attribution. Reports remain owner-only.
alter table public.site_analytics_events add column campaign text not null default ''
  check(length(campaign)<=60 and campaign ~ '^[a-zA-Z0-9_-]*$');
alter table public.site_analytics_events drop constraint site_analytics_events_source_category_check;
alter table public.site_analytics_events add constraint site_analytics_events_source_category_check
  check(source_category in ('Direct','Facebook / Instagram','Google','Other','WhatsApp'));
create function public.record_site_event_v2(event_id uuid,visit_id uuid,event_name text,
  listing_id text default '',listing_title text default '',device_type text default 'Desktop',source_category text default 'Direct',campaign text default '')
returns void language plpgsql security definer set search_path=''
as $$ declare headers jsonb; day_start timestamptz:=date_trunc('day',now());
begin
  headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  if headers->>'origin' is distinct from 'https://mari-property-melaka.txleong1998596286.chatgpt.site' then return; end if;
  if event_id is null or visit_id is null or event_name is null or event_name not in ('page_view','listing_view','whatsapp_click') then return; end if;
  if device_type is null or device_type not in ('Mobile','Tablet','Desktop') or source_category is null or source_category not in ('Direct','Facebook / Instagram','Google','Other','WhatsApp') then return; end if;
  if listing_id is null or listing_title is null or length(listing_id)>100 or length(listing_title)>160 or listing_id !~ '^[a-zA-Z0-9_-]*$' then return; end if;
  if campaign is null or length(campaign)>60 or campaign !~ '^[a-zA-Z0-9_-]*$' then return; end if;
  if event_name='listing_view' and listing_id='' then return; end if;
  perform pg_advisory_xact_lock(73194,924);
  if (select count(*) from public.site_analytics_events e where e.recorded_at>=day_start)>=30000 then return; end if;
  if (select count(*) from public.site_analytics_events e where e.visit_id=record_site_event_v2.visit_id and e.recorded_at>=day_start)>=300 then return; end if;
  insert into public.site_analytics_events(event_id,visit_id,event_name,listing_id,listing_title,device_type,source_category,campaign)
    values(event_id,visit_id,event_name,listing_id,listing_title,device_type,source_category,campaign) on conflict do nothing;
end $$;
revoke all on function public.record_site_event_v2(uuid,uuid,text,text,text,text,text,text) from public;
grant execute on function public.record_site_event_v2(uuid,uuid,text,text,text,text,text,text) to anon,authenticated;
create function public.get_site_campaigns(days integer default 7)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; report jsonb;
begin
 if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then raise exception 'Owner access required' using errcode='42501'; end if;
 if days is null or days not in(7,30,90) then raise exception 'Choose 7, 30 or 90 days'; end if;
 select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) into report from (
   select source_category as source,campaign,count(distinct visit_id) as visits,count(*) filter(where event_name='whatsapp_click') as enquiries
   from public.site_analytics_events where campaign<>'' and recorded_at>=(today-(days-1))::timestamp at time zone 'Asia/Kuala_Lumpur'
     and recorded_at<(today+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
   group by source_category,campaign order by visits desc,source_category,campaign limit 50
 ) t;
 return report;
end $$;
revoke all on function public.get_site_campaigns(integer) from public,anon,authenticated;
grant execute on function public.get_site_campaigns(integer) to authenticated;

