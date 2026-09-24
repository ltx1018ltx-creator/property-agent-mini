-- Synthetic analytics only; all test writes roll back.
begin;
select set_config('test.visit',gen_random_uuid()::text,true),set_config('test.event',gen_random_uuid()::text,true);
set local role anon;
select set_config('request.headers','{"origin":"https://example.invalid"}',true);
select public.record_site_event(current_setting('test.event')::uuid,current_setting('test.visit')::uuid,'page_view');
reset role;
do $$ begin if exists(select 1 from public.site_analytics_events where visit_id=current_setting('test.visit')::uuid) then raise exception 'Invalid origin accepted';end if;end $$;
set local role anon;
select set_config('request.headers','{"origin":"https://mari-property-melaka.txleong1998596286.chatgpt.site"}',true);
select public.record_site_event(current_setting('test.event')::uuid,current_setting('test.visit')::uuid,'page_view');
select public.record_site_event(current_setting('test.event')::uuid,current_setting('test.visit')::uuid,'page_view');
select public.record_site_event(gen_random_uuid(),current_setting('test.visit')::uuid,'listing_view','qa-property','QA property','Mobile','Direct');
select public.record_site_event(gen_random_uuid(),current_setting('test.visit')::uuid,'whatsapp_click','qa-property','QA property','Mobile','Direct');
do $$ begin
 begin perform public.get_site_analytics(7);raise exception 'Anonymous report exposed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.site_analytics_events;raise exception 'Anonymous raw rows exposed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
 begin perform public.get_site_analytics(7);raise exception 'Other account report exposed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.site_analytics_events;raise exception 'Member raw rows exposed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','6c8e4545-3e89-40e2-b5a9-7a18475641d7',true);
do $$ declare report jsonb;begin
 report:=public.get_site_analytics(7);
 if jsonb_array_length(report->'daily')<>7 or (report->>'page_views')::int<1 then raise exception 'Report totals wrong';end if;
 if not exists(select 1 from jsonb_array_elements(report->'listings') t where t->>'listing_id'='qa-property' and (t->>'views')::int=1 and (t->>'enquiries')::int=1) then raise exception 'Property aggregates wrong';end if;
 if jsonb_array_length(public.get_site_analytics(30)->'daily')<>30 then raise exception '30-day range wrong';end if;
 if jsonb_array_length(public.get_site_analytics(90)->'daily')<>90 then raise exception '90-day range wrong';end if;
end $$;
reset role;
do $$ begin if (select count(*) from public.site_analytics_events where visit_id=current_setting('test.visit')::uuid)<>3 then raise exception 'Deduplication failed';end if;end $$;
rollback;
