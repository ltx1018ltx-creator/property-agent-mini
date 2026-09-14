-- Phase 2 WhatsApp image ingestion. Safe to run repeatedly.
insert into storage.buckets (id, name, public)
values ('whatsapp-ingestion', 'whatsapp-ingestion', false)
on conflict (id) do update set public = false;

alter table public.listing_submission_messages
  add column if not exists media_storage_bucket text,
  add column if not exists media_storage_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_size_bytes bigint,
  add column if not exists media_status text,
  add column if not exists media_error_code text,
  add column if not exists media_processing_at timestamptz;

do $$ begin
  alter table public.listing_submission_messages
    add constraint listing_submission_messages_media_status_check
    check (media_status is null or media_status in ('pending', 'stored', 'rejected', 'failed'));
exception when duplicate_object then null;
end $$;

update public.listing_submission_messages
   set media_status = 'pending'
 where message_type = 'image' and meta_media_id is not null and media_status is null;

-- Restrictive policies deny this bucket to browser roles even if another broad
-- permissive storage policy exists, without changing access to other buckets.
drop policy if exists whatsapp_ingestion_anon_deny on storage.objects;
create policy whatsapp_ingestion_anon_deny on storage.objects as restrictive
  for all to anon using (bucket_id <> 'whatsapp-ingestion')
  with check (bucket_id <> 'whatsapp-ingestion');
drop policy if exists whatsapp_ingestion_authenticated_deny on storage.objects;
create policy whatsapp_ingestion_authenticated_deny on storage.objects as restrictive
  for all to authenticated using (bucket_id <> 'whatsapp-ingestion')
  with check (bucket_id <> 'whatsapp-ingestion');

create or replace function public.claim_whatsapp_image(message_id text)
returns table (claimed boolean, storage_path text)
language plpgsql security invoker set search_path = public
as $$
declare submission uuid; object_path text;
begin
  update public.listing_submission_messages
     set media_processing_at = now(),
         media_storage_bucket = 'whatsapp-ingestion',
         -- A retry must target the object chosen by the original claim. This
         -- keeps an upload/finish interruption from leaving orphaned objects.
         media_storage_path = coalesce(
           media_storage_path,
           listing_submission_id::text || '/' || gen_random_uuid()::text
         )
   where meta_message_id = message_id and message_type = 'image'
     and meta_media_id is not null and media_status = 'pending'
     and (media_processing_at is null or media_processing_at < now() - interval '15 minutes')
  returning listing_submission_id, media_storage_path into submission, object_path;
  if submission is null then return query select false, null::text;
  else return query select true, object_path; end if;
end;
$$;

create or replace function public.finish_whatsapp_image(
  message_id text, new_status text, mime_type text, size_bytes bigint, error_code text)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if new_status not in ('stored', 'rejected', 'failed') then raise exception 'invalid media status'; end if;
  update public.listing_submission_messages
     set media_status = new_status,
         media_mime_type = case when new_status = 'stored' then mime_type else null end,
         media_size_bytes = case when new_status = 'stored' then size_bytes else null end,
         media_error_code = case when new_status = 'stored' then null else error_code end,
         media_processing_at = null
   where meta_message_id = message_id and media_status = 'pending' and media_processing_at is not null;
end;
$$;

revoke all on function public.claim_whatsapp_image(text) from public, anon, authenticated;
revoke all on function public.finish_whatsapp_image(text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_image(text) to service_role;
grant execute on function public.finish_whatsapp_image(text,text,text,bigint,text) to service_role;
grant update (media_storage_bucket, media_storage_path, media_mime_type, media_size_bytes,
              media_status, media_error_code, media_processing_at)
  on public.listing_submission_messages to service_role;

-- New inserts become claimable without changing the Phase 1 RPC's signature.
create or replace function public.set_whatsapp_media_pending()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.message_type = 'image' and new.meta_media_id is not null then new.media_status := 'pending'; end if;
  return new;
end;
$$;
drop trigger if exists set_whatsapp_media_pending on public.listing_submission_messages;
create trigger set_whatsapp_media_pending before insert on public.listing_submission_messages
for each row execute function public.set_whatsapp_media_pending();
revoke all on function public.set_whatsapp_media_pending() from public, anon, authenticated;

notify pgrst, 'reload schema';
