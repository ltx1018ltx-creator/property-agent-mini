-- Extend the existing private event store; old clients and historical reports remain valid.
begin;
alter table public.site_analytics_events add column measurement_version smallint not null default 1;
alter table public.site_analytics_events add column details jsonb not null default '{}'::jsonb;
alter table public.site_analytics_events drop constraint site_analytics_events_event_name_check;
alter table public.site_analytics_events add constraint site_analytics_events_event_name_check
  check(event_name in ('page_view','listing_view','whatsapp_click','filter_apply','shortlist_add','shortlist_remove','photo_error'));
alter table public.site_analytics_events add constraint site_analytics_details_size check(octet_length(details::text)<=12000);

create function public.record_site_event_v3(event_id uuid, visit_id uuid, event_name text,
  listing_id text default '', listing_title text default '', device_type text default 'Desktop',
  source_category text default 'Direct', campaign text default '', details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare
  headers jsonb; clean jsonb := '{}'::jsonb; ids jsonb; areas jsonb; title text := '';
  field text; day_start timestamptz:=date_trunc('day',now());
  allowed_areas text[] := array['Alai','Alor Gajah','Ayer Keroh','Ayer Molek','Bachang','Bandar Hilir','Batang Melaka','Batu Berendam','Belimbing','Bemban','Bertam','Brisu','Bukit Baru','Bukit Beruang','Bukit Katil','Bukit Lintang','Bukit Piatu','Bukit Rambai','Bukit Serindit','Cheng','Durian Tunggal','Duyong','Jasin','Kandang','Klebang','Kota Laksamana','Krubong','Limbongan','Malim','Malim Jaya','Masjid Tanah','Melaka Baru','Melaka City','Melaka Raya','Merlimau','Paya Dalam','Paya Rumput','Pertam Jaya','Semabok','Sungai Udang','Taman Merdeka','Taman Tasik Utama','Tanjung Minyak','Tengkera','Tiang Dua','Ujong Pasir','Other area'];
begin
  headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  if headers->>'origin' is distinct from 'https://mari-property-melaka.txleong1998596286.chatgpt.site' then return; end if;
  if event_id is null or visit_id is null or event_name is null or event_name not in ('page_view','listing_view','whatsapp_click','filter_apply','shortlist_add','shortlist_remove','photo_error') then return; end if;
  if device_type is null or device_type not in ('Mobile','Tablet','Desktop') or source_category is null or source_category not in ('Direct','Facebook / Instagram','Google','Other','WhatsApp') then return; end if;
  if campaign is null or length(campaign)>60 or campaign !~ '^[a-zA-Z0-9_-]*$' then return; end if;
  if listing_id is null or length(listing_id)>100 or details is null or jsonb_typeof(details)<>'object' or octet_length(details::text)>12000 then return; end if;
  -- Resolve property names from public catalog records, never accept visitor-supplied text.
  if listing_id<>'' then
    select left(coalesce(t.listing->>'title',t.listing->>'location','Property'),160) into title
    from public.team_listings t where t.id::text=listing_id and t.owner_id='6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid;
    if not found then return; end if;
  elsif event_name in ('listing_view','shortlist_add','shortlist_remove','photo_error') then return;
  end if;
  if event_name='filter_apply' then
    if details->>'purpose' is null or details->>'purpose' not in ('sale','rent') or
      details->>'type' is null or details->>'type' not in ('','Condo','Landed','Factory','Shoplot','Land','Other') then return; end if;
    if jsonb_typeof(details->'areas') is distinct from 'array' or jsonb_array_length(details->'areas')>50 then return; end if;
    select coalesce(jsonb_agg(area order by area),'[]'::jsonb) into areas from
      (select distinct case when value=any(allowed_areas) then value else 'Other area' end area from jsonb_array_elements_text(details->'areas')) a;
    clean:=jsonb_build_object('purpose',details->>'purpose','type',details->>'type','areas',areas);
    foreach field in array array['min_price','max_price','min_size','max_size','bedrooms','result_count'] loop
      if not (details ? field) or jsonb_typeof(details->field) not in ('null','number') then return; end if;
      if jsonb_typeof(details->field)='number' and ((details->>field)::numeric<0 or (details->>field)::numeric>1000000000 or (details->>field)::numeric<>trunc((details->>field)::numeric)) then return; end if;
      clean:=clean||jsonb_build_object(field,details->field);
    end loop;
    if clean->>'result_count' is null then return; end if;
    if details->>'tenure' is null or details->>'tenure' not in ('','Freehold','Leasehold') or
      details->>'furnishing' is null or details->>'furnishing' not in ('','Unfurnished','Partly furnished','Fully furnished') then return; end if;
    clean:=clean||jsonb_build_object('tenure',details->>'tenure','furnishing',details->>'furnishing');
    if (clean->>'min_price')::numeric>(clean->>'max_price')::numeric or (clean->>'min_size')::numeric>(clean->>'max_size')::numeric then return; end if;
  elsif event_name='whatsapp_click' then
    if details ? 'listing_ids' then
      if jsonb_typeof(details->'listing_ids')<>'array' or jsonb_array_length(details->'listing_ids')>100 then return; end if;
      select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into ids from (
        select distinct t.id::text id from jsonb_array_elements_text(details->'listing_ids') a(value)
        join public.team_listings t on t.id::text=a.value and t.owner_id='6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid
      ) valid;
      clean:=jsonb_build_object('listing_ids',ids);
    end if;
  end if;
  -- Existing bounded recording policy. Origin is a contamination filter, not authentication.
  perform pg_advisory_xact_lock(73194,924);
  if (select count(*) from public.site_analytics_events e where e.recorded_at>=day_start)>=30000 then return; end if;
  if (select count(*) from public.site_analytics_events e where e.visit_id=record_site_event_v3.visit_id and e.recorded_at>=day_start)>=300 then return; end if;
  insert into public.site_analytics_events(event_id,visit_id,event_name,listing_id,listing_title,device_type,source_category,campaign,measurement_version,details)
  values(event_id,visit_id,event_name,listing_id,title,device_type,source_category,campaign,3,clean) on conflict do nothing;
end $$;
revoke all on function public.record_site_event_v3(uuid,uuid,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.record_site_event_v3(uuid,uuid,text,text,text,text,text,text,jsonb) to anon,authenticated;

create function public.get_site_insights(days integer default 7)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then
    raise exception 'Owner access required' using errcode='42501'; end if;
  if days is null or days not in (7,30,90) then raise exception 'Choose 7, 30 or 90 days'; end if;
  return (
    with e as materialized (
      select * from public.site_analytics_events where measurement_version=3
      and recorded_at>=(today-(days-1))::timestamp at time zone 'Asia/Kuala_Lumpur'
      and recorded_at<(today+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    ), visits as (
      select visit_id, min(recorded_at) filter(where event_name='listing_view') first_detail,
        max(recorded_at) filter(where event_name='whatsapp_click') last_contact,
        bool_or(event_name='filter_apply') filtered, bool_or(event_name='shortlist_add') shortlisted,
        bool_or(event_name='filter_apply' and details->>'result_count'='0') zero_results,
        bool_or(event_name='photo_error') photo_failed
      from e group by visit_id
    ), targeted as (
      select e.*, target.id property_id from e cross join lateral (
        select listing_id id where listing_id<>''
        union select value from jsonb_array_elements_text(coalesce(details->'listing_ids','[]'::jsonb)) where event_name='whatsapp_click'
      ) target
    ), property_visits as (
      select property_id,visit_id,max(listing_title) title,
        min(recorded_at) filter(where event_name='listing_view') first_view,
        max(recorded_at) filter(where event_name='whatsapp_click') last_contact,
        bool_or(event_name='shortlist_add') shortlisted, bool_or(event_name='photo_error') photo_failed
      from targeted group by property_id,visit_id
    ), properties as (
      select property_id,max(title) title,count(*) filter(where first_view is not null) views,
        count(*) filter(where shortlisted) shortlists,count(*) filter(where last_contact is not null) contacts,
        count(*) filter(where last_contact>=first_view) converted,count(*) filter(where photo_failed) photo_errors
      from property_visits group by property_id
    ), searches as materialized (
      select visit_id, details-'result_count' criteria,(details->>'result_count')::integer result_count
      from e where event_name='filter_apply'
    ), combinations as (
      select criteria,count(distinct visit_id) visits,count(distinct visit_id) filter(where result_count=0) zero_visits
      from searches group by criteria
    ), dimensions as (
      select visit_id,'area' dimension,area label from searches cross join lateral jsonb_array_elements_text(criteria->'areas') a(area)
      union all select visit_id,'type',coalesce(nullif(criteria->>'type',''),'Any type') from searches
      union all select visit_id,'purpose',criteria->>'purpose' from searches
      union all select visit_id,'budget',concat(criteria->>'purpose','|',coalesce(criteria->>'min_price',''),'|',coalesce(criteria->>'max_price','')) from searches
    ), ranked_dimensions as (
      select dimension,label,count(distinct visit_id) visits, row_number() over(partition by dimension order by count(distinct visit_id) desc,label) rank
      from dimensions group by dimension,label
    )
    select jsonb_build_object(
      'generated_at',now(),'days',days,
      'started_at',(select min(recorded_at) from public.site_analytics_events where measurement_version=3),
      'summary',(select jsonb_build_object('visits',count(*),'details',count(*) filter(where first_detail is not null),
        'contacts',count(*) filter(where last_contact is not null),'after_detail',count(*) filter(where last_contact>=first_detail),
        'filtered',count(*) filter(where filtered),'shortlisted',count(*) filter(where shortlisted),
        'zero_results',count(*) filter(where zero_results),'photo_errors',count(*) filter(where photo_failed)) from visits),
      'properties',coalesce((select jsonb_agg(row_to_json(p)) from (select * from properties order by views desc,contacts desc,property_id limit 100) p),'[]'::jsonb),
      'demand',coalesce((select jsonb_agg(row_to_json(d)) from (select dimension,label,visits from ranked_dimensions where rank<=10 order by dimension,rank) d),'[]'::jsonb),
      'unmatched',coalesce((select jsonb_agg(row_to_json(c)) from (select * from combinations where zero_visits>0 order by zero_visits desc,visits desc,criteria::text limit 10) c),'[]'::jsonb)
    )
  );
end $$;
revoke all on function public.get_site_insights(integer) from public,anon,authenticated;
grant execute on function public.get_site_insights(integer) to authenticated;
-- Direct access remains denied. Only the guarded owner report returns aggregates.
alter table public.site_analytics_events enable row level security;
revoke all on public.site_analytics_events from public,anon,authenticated;
commit;
