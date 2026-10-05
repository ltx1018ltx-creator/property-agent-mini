-- All synthetic activity rolls back; never contaminates the live dashboard.
begin;
do $$
declare p text; v uuid:=gen_random_uuid(); v2 uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); base integer; r jsonb; c jsonb;
begin
 select id::text into p from public.team_listings where owner_id='6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid limit 1;
 select count(*) into base from public.site_analytics_events;
 perform set_config('request.headers','{"origin":"https://mari-property-melaka.txleong1998596286.chatgpt.site"}',true);
 perform public.record_site_event_v3(eid,v,'page_view');
 perform public.record_site_event_v3(eid,v,'page_view');
 if (select count(*) from public.site_analytics_events)<>base+1 then raise exception 'Duplicate event counted'; end if;
 perform public.record_site_event_v3(gen_random_uuid(),v,'listing_view',p,'not trusted');
 perform public.record_site_event_v3(gen_random_uuid(),v,'listing_view',p);
 perform public.record_site_event_v3(gen_random_uuid(),v,'shortlist_add',p);
 perform public.record_site_event_v3(gen_random_uuid(),v,'photo_error',p);
 perform public.record_site_event_v3(gen_random_uuid(),v,'whatsapp_click','','','Desktop','Direct','',jsonb_build_object('listing_ids',jsonb_build_array(p,p),'phone','do not store'));
 c:='{"purpose":"sale","type":"Landed","areas":["Batu Berendam","private address"],"min_price":null,"max_price":500000,"min_size":null,"max_size":null,"bedrooms":null,"result_count":0,"tenure":"","furnishing":"","name":"do not store"}';
 perform public.record_site_event_v3(gen_random_uuid(),v,'filter_apply','','','Desktop','Direct','',c);
 perform public.record_site_event_v3(gen_random_uuid(),v,'filter_apply','','','Desktop','Direct','',c);
 if exists(select 1 from public.site_analytics_events where visit_id=v and (details::text like '%private address%' or details::text like '%do not store%' or listing_title='not trusted')) then raise exception 'Untrusted text stored'; end if;
 select count(*) into base from public.site_analytics_events;
 perform public.record_site_event_v3(gen_random_uuid(),v,'filter_apply','','','Desktop','Direct','',c||'{"result_count":null}');
 perform public.record_site_event_v3(gen_random_uuid(),v,'listing_view','not-a-property');
 perform set_config('request.headers','{"origin":"https://other.invalid"}',true);
 perform public.record_site_event_v3(gen_random_uuid(),v,'page_view');
 if (select count(*) from public.site_analytics_events)<>base then raise exception 'Invalid input accepted'; end if;
 perform set_config('request.jwt.claim.sub','6c8e4545-3e89-40e2-b5a9-7a18475641d7',true);
 r:=public.get_site_insights(7);
 if not exists(select 1 from jsonb_array_elements(r->'properties') x where x->>'property_id'=p and (x->>'views')::int>=1 and (x->>'contacts')::int>=1 and (x->>'converted')::int>=1) then raise exception 'Multi enquiry attribution missing'; end if;
 if not exists(select 1 from jsonb_array_elements(r->'unmatched') x where x->'criteria'->'areas' ? 'Other area' and (x->>'zero_visits')::int=1) then raise exception 'Search dedup/redaction failed'; end if;
 if (r->'summary'->>'after_detail')::int>(r->'summary'->>'details')::int then raise exception 'Invalid funnel'; end if;
 -- Report authorization is checked in the function, independent of hidden navigation.
 perform set_config('request.jwt.claim.sub',v2::text,true);
 begin perform public.get_site_insights(7); raise exception 'Member could read report'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.get_site_insights(integer)','execute') then raise exception 'Anonymous report access'; end if;
 if has_table_privilege('anon','public.site_analytics_events','select') or has_table_privilege('authenticated','public.site_analytics_events','select') then raise exception 'Direct event access'; end if;
end $$;
rollback;
