-- Move the owner-approved public listing into the existing backend.
-- The database generates the new ID; legacyReference keeps the previous link valid.
insert into public.team_listings(owner_id, listing)
select '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid, jsonb_build_object(
  'legacyReference','MARI-PJ-001','title','Pertam Jaya · Double-storey home',
  'location','Pertam Jaya','locationArea','Pertam Jaya','locationMode','manual',
  'propertyType','Terrace House','propertySubtype','2 Storey','deal','For Sale',
  'price','480000','tenure','Leasehold','leaseYears','73','bedrooms','4','bathrooms','3',
  'landSize','1200','builtUp','','renovation','Fully Renovated',
  'furnishing','Not Specified','status','For Sale',
  'publicHighlights','Well maintained · Nearby Padang',
  'photos',(select jsonb_agg('https://mari-property-melaka.txleong1998596286.chatgpt.site/assets/pertam-jaya/optimized/' || filename order by position)
    from unnest(array['01-living-cover.jpg','02-living.jpg','03-dining.jpg','04-kitchen.jpg','05-kitchen-wide.jpg','06-bedroom.jpg','07-room.jpg','08-blue-room.jpg','09-bedroom.jpg','10-bathroom.jpg','11-bathroom.jpg','12-utility.jpg']) with ordinality files(filename,position))
)
where not exists(select 1 from public.team_listings where owner_id='6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid and listing->>'legacyReference'='MARI-PJ-001')
returning id, listing->>'legacyReference' as previous_reference;

