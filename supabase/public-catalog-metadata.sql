-- Unpack each large listing JSON once. Photos/private text never enter this response.
-- SECURITY INVOKER retains the existing table access and row-level policies.
create function public.get_public_listing_catalog(catalog_owner uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'created_at',l.created_at,'updated_at',l.updated_at,'data',fields.data)
   order by l.created_at desc,l.id),'[]'::jsonb)
 from public.team_listings l
 cross join lateral (
   select jsonb_object_agg(key,value) as data from jsonb_each(l.listing)
   where key in ('title','location','locationArea','propertyType','propertySubtype','lotType','price','deal','tenure',
     'bedrooms','bathrooms','landSize','builtUp','furnishing','renovation','leaseYears','status','legacyReference','publicHighlights')
 ) fields
 where l.owner_id=catalog_owner;
$$;
revoke all on function public.get_public_listing_catalog(uuid) from public;
grant execute on function public.get_public_listing_catalog(uuid) to anon,authenticated;

