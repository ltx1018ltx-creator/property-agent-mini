-- Phase 3B approved draft publishing. Safe to run repeatedly.
alter table public.listing_submission_drafts
  add column if not exists published_listing_id uuid references public.team_listings(id) on delete set null,
  add column if not exists published_at timestamptz;

create unique index if not exists listing_submission_drafts_published_listing_unique
  on public.listing_submission_drafts (published_listing_id) where published_listing_id is not null;

create or replace function public.prevent_published_draft_changes()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.published_listing_id is not null and (new.structured_data,new.marketing_copy,new.status,new.published_listing_id)
    is distinct from (old.structured_data,old.marketing_copy,old.status,old.published_listing_id) then
    raise exception 'published_draft_is_immutable';
  end if;
  return new;
end $$;
drop trigger if exists prevent_published_draft_changes on public.listing_submission_drafts;
create trigger prevent_published_draft_changes before update on public.listing_submission_drafts
for each row execute function public.prevent_published_draft_changes();
revoke all on function public.prevent_published_draft_changes() from public,anon,authenticated;

insert into storage.buckets (id,name,public)
values ('listing-images','listing-images',true)
on conflict (id) do update set public=true;

drop policy if exists listing_images_public_read on storage.objects;
create policy listing_images_public_read on storage.objects for select to anon,authenticated
  using (bucket_id='listing-images');

create or replace function public.publish_approved_listing(draft_id uuid, publishing_owner uuid, clean_listing jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare draft public.listing_submission_drafts; listing_id uuid;
begin
  if publishing_owner is null or clean_listing is null or jsonb_typeof(clean_listing)<>'object' then
    raise exception 'invalid_publish_request';
  end if;
  -- Defense in depth: the server maps these keys, and the transaction rejects extras.
  if exists (select 1 from jsonb_object_keys(clean_listing) key where key not in
    ('location','propertyType','propertySubtype','tenure','leaseYears','leaseExpiry','lotType','deal','price',
     'landSize','builtUp','bedrooms','bathrooms','carParks','furnishing','renovation','titleType','landTitle',
     'bumiLot','facing','rawText','title','photos','shareId')) then raise exception 'invalid_listing_field'; end if;
  select * into draft from public.listing_submission_drafts where id=draft_id for update;
  if draft.id is null then raise exception 'draft_not_found'; end if;
  if draft.published_listing_id is not null then
    return jsonb_build_object('listing_id',draft.published_listing_id,'published_at',draft.published_at,'duplicate',true);
  end if;
  if draft.status<>'approved' then raise exception 'draft_not_approved'; end if;
  insert into public.team_listings(owner_id,listing) values(publishing_owner,clean_listing) returning id into listing_id;
  update public.listing_submission_drafts set published_listing_id=listing_id,published_at=now() where id=draft.id;
  return jsonb_build_object('listing_id',listing_id,'published_at',now(),'duplicate',false);
end $$;
revoke all on function public.publish_approved_listing(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_approved_listing(uuid,uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
