-- Synthetic accounts and records only. Always roll back.
begin;
select set_config('test.a',gen_random_uuid()::text,true),set_config('test.b',gen_random_uuid()::text,true);
insert into auth.users(id,email,aud,role,invited_at,email_confirmed_at)
select id,id::text||'@example.invalid','authenticated','authenticated',now(),now()
from unnest(array[current_setting('test.a')::uuid,current_setting('test.b')::uuid]) id;
insert into public.team_listings(owner_id,listing) values
 (current_setting('test.a')::uuid,'{"location":"Tmn Sri Songket","price":480000}'),
 (current_setting('test.a')::uuid,'{"location":"QA Gardens"}'),
 (current_setting('test.a')::uuid,'{"location":"QA Gardens","locationMode":"manual","locationArea":"Cheng"}'),
 (current_setting('test.b')::uuid,'{"location":"QA Gardens"}');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.a'),true);
do $$ begin
 if public.preview_listing_area('Taman Seri Songket')->>'area'<>'Batu Berendam' then raise exception 'Confirmed rule missing';end if;
 if public.preview_listing_area('TMN. SRI SONGKET')->>'area'<>'Batu Berendam' then raise exception 'Spelling normalization failed';end if;
 if public.preview_listing_area('Noa Residence, Pulau Gadong')->>'area'<>'Pulau Gadong' then raise exception 'Address match failed';end if;
 if public.preview_listing_area('Malim Jaya')->>'area'<>'Malim Jaya' then raise exception 'Specific area lost';end if;
 if public.preview_listing_area('Laksamana Cheng Ho')->>'area'<>'' then raise exception 'Person name mistaken for area';end if;
 if public.preview_listing_area('Mystery Place nearby Cheng')->>'area'<>'' then raise exception 'Nearby text classified';end if;
 if public.preview_listing_area('Bukit Rembia, Alor Gajah')->>'area'<>'' then raise exception 'Ambiguous area classified';end if;
 if public.remember_listing_area('QA Gardens','Batu Berendam')<>1 then raise exception 'Remember did not update matching auto record';end if;
 if (select count(*) from public.team_listings where owner_id=auth.uid() and listing->>'location'='QA Gardens' and listing->>'locationArea'='Cheng')<>1 then raise exception 'Manual override lost';end if;
 if not exists(select 1 from public.team_listings where owner_id=auth.uid() and listing->>'location'='Tmn Sri Songket' and listing->>'price'='480000' and listing->>'locationArea'='Batu Berendam') then raise exception 'Original data lost';end if;
 insert into public.team_listings(owner_id,listing) values(auth.uid(),'{"location":"QA Gardens"}');
 if (select count(*) from public.team_listings where owner_id=auth.uid() and listing->>'location'='QA Gardens' and listing->>'locationArea'='Batu Berendam')<>2 then raise exception 'New listing did not inherit rule';end if;
 begin perform public.resolve_listing_area_internal('QA Gardens',current_setting('test.b')::uuid);raise exception 'Internal resolver exposed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.b'),true);
do $$ begin
 if exists(select 1 from public.listing_location_rules) then raise exception 'Other member rules exposed';end if;
 if public.preview_listing_area('QA Gardens')->>'area'<>'' then raise exception 'Other member rule applied';end if;
 if exists(select 1 from public.team_listings where owner_id=auth.uid() and listing->>'locationArea'<>'') then raise exception 'Other member listing modified';end if;
end $$;
reset role;
update public.workspace_members set status='suspended' where user_id=current_setting('test.b')::uuid;
set local role authenticated;
do $$ begin
 begin perform public.remember_listing_area('QA Gardens','Cheng');raise exception 'Suspended write allowed';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin
 begin perform public.remember_listing_area('QA Gardens','Cheng');raise exception 'Anonymous write allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.listing_location_rules;raise exception 'Anonymous rules exposed';exception when insufficient_privilege then null;end;
end $$;
rollback;

