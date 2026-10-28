-- Photo-only, optimistic-concurrency update. Existing ownership and membership required.
create function public.update_listing_photos(listing_id uuid, expected_revision timestamptz, changes jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item public.team_listings; result jsonb;
begin
 if auth.uid() is null or not public.is_workspace_member() then raise exception 'Active membership required' using errcode='42501';end if;
 if changes is null or jsonb_typeof(changes)<>'object' or jsonb_typeof(changes->'photos') is distinct from 'array'
 or changes - array['photos','shareId','coverMode','coverIndex'] <> '{}'::jsonb then raise exception 'Invalid photo changes';end if;
 if exists(select 1 from jsonb_array_elements(changes->'photos') p where jsonb_typeof(p)<>'string') then raise exception 'Invalid photos';end if;
 select * into item from public.team_listings t where t.id=listing_id and t.owner_id=auth.uid() for update;
 if item.id is null then raise exception 'Listing not found or you cannot edit it' using errcode='42501';end if;
 if expected_revision is null or item.updated_at is distinct from expected_revision then raise exception 'Listing changed elsewhere. Close and reopen Photos before saving.' using errcode='40001';end if;
 if changes ? 'coverMode' and (changes->>'coverMode'<>'manual' or changes->>'coverIndex'<>'0') then raise exception 'Invalid cover selection';end if;
 update public.team_listings t set listing=(t.listing-'photo')||changes,updated_at=now() where t.id=listing_id
 returning jsonb_build_object('id',t.id,'updated_at',t.updated_at) into result;
 return result;
end $$;
revoke all on function public.update_listing_photos(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.update_listing_photos(uuid,timestamptz,jsonb) to authenticated;

create or replace function public.get_public_listing_catalog(catalog_owner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'created_at',l.created_at,
 'updated_at',l.updated_at,'data',l.public_catalog_data||jsonb_build_object('manualCoverFirst',l.listing->>'coverMode'='manual'))
 order by l.created_at desc,l.id),'[]'::jsonb)
 from public.team_listings l where l.owner_id=catalog_owner;
$$;
