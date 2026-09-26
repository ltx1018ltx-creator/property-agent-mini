-- Small edits merge into the existing JSON without retransmitting its photographs.
begin;
create function public.update_listing_details(listing_id uuid, changes jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_workspace_member() then
   raise exception 'Active membership required' using errcode='42501';
 end if;
 if changes is null or jsonb_typeof(changes)<>'object' then raise exception 'Invalid listing changes';end if;
 if changes ? 'photos' and jsonb_typeof(changes->'photos')<>'array' then raise exception 'Invalid photos';end if;
 -- The existing RLS policies still apply; even admins edit only their own listings.
 update public.team_listings t set listing=(case when changes ? 'photos' then t.listing-'photo' else t.listing end)||(changes-'locationStatus'),updated_at=now()
 where t.id=listing_id and t.owner_id=auth.uid()
 returning jsonb_build_object('id',t.id,'owner_id',t.owner_id,'created_at',t.created_at,'updated_at',t.updated_at,
   'listing',t.listing-'photos'-'photo') into result;
 if result is null then raise exception 'Listing not found or you cannot edit it' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.update_listing_details(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_listing_details(uuid,jsonb) to authenticated;
commit;

