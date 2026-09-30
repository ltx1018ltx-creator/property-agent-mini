-- Admin-managed shared filter locations. Invoker functions keep RLS in force.
begin;
grant insert(name) on public.listing_areas to authenticated;
create policy areas_admin_insert on public.listing_areas for insert to authenticated
 with check ((select public.is_workspace_member()) and (select public.is_admin())
   and char_length(name) between 3 and 100 and name !~ '[[:cntrl:]]');
create function public.add_listing_area(area_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare clean_name text:=trim(regexp_replace(area_name,'[[:space:]]+',' ','g')); existing text;
begin
 if auth.uid() is null or not public.is_workspace_member() or not public.is_admin() then
  raise exception 'Only an active admin can add locations' using errcode='42501';
 end if;
 if clean_name is null or char_length(clean_name) not between 3 and 100 or clean_name ~ '[[:cntrl:]]'
   or char_length(public.location_key(clean_name))<3 then
  raise exception 'Enter a location name of 3–100 characters, including its English or Malay name';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(public.location_key(clean_name),0));
 select name into existing from public.listing_areas where public.location_key(name)=public.location_key(clean_name) order by name limit 1;
 if existing is not null then return jsonb_build_object('name',existing,'created',false);end if;
 insert into public.listing_areas(name) values(clean_name);
 return jsonb_build_object('name',clean_name,'created',true);
end $$;
revoke all on function public.add_listing_area(text) from public,anon,authenticated;
grant execute on function public.add_listing_area(text) to authenticated;
commit;

