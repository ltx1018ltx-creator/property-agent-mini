-- Atomic five-minute WhatsApp conversation grouping and admin merge support.
-- Safe to run repeatedly after the Phase 1, Phase 2, and Phase 3 migrations.
alter table public.listing_submissions
  add column if not exists conversation_key text;

update public.listing_submissions
   set conversation_key = encode(digest(
     least(sender_redacted, recipient_redacted) || '|' ||
     greatest(sender_redacted, recipient_redacted), 'sha256'), 'hex')
 where conversation_key is null;

alter table public.listing_submissions
  alter column conversation_key set not null;

create index if not exists listing_submissions_conversation_activity_idx
  on public.listing_submissions (conversation_key, last_activity_at desc);

create or replace function public.ingest_whatsapp_message(event jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  submission_id uuid;
  meta_event_time timestamptz;
  receipt_time timestamptz := clock_timestamp();
  stable_conversation_key text;
begin
  if event->>'meta_message_id' is null
     or event->>'event_type' not in ('messages', 'smb_message_echoes')
     or event->>'message_type' is null
     or event->>'sender' is null
     or event->>'recipient' is null then
    raise exception 'invalid WhatsApp event';
  end if;

  meta_event_time := to_timestamp((event->>'timestamp')::double precision);
  stable_conversation_key := encode(digest(
    least(event->>'sender', event->>'recipient') || '|' ||
    greatest(event->>'sender', event->>'recipient'), 'sha256'), 'hex');

  -- Serialize every delivery direction and webhook batch for this conversation.
  perform pg_advisory_xact_lock(hashtextextended(stable_conversation_key, 0));

  select m.listing_submission_id into submission_id
    from public.listing_submission_messages m
   where m.meta_message_id = event->>'meta_message_id';
  if submission_id is not null then return submission_id; end if;

  select s.id into submission_id
    from public.listing_submissions s
   where s.conversation_key = stable_conversation_key
     and s.last_activity_at >= receipt_time - interval '5 minutes'
     and not exists (
       select 1 from public.listing_submission_drafts d
        where d.listing_submission_id = s.id
     )
   order by s.last_activity_at desc, s.id
   limit 1
   for update of s;

  if submission_id is null then
    insert into public.listing_submissions
      (event_type, sender_redacted, recipient_redacted, conversation_key, started_at, last_activity_at)
    values
      (event->>'event_type', event->>'sender', event->>'recipient', stable_conversation_key,
       receipt_time, receipt_time)
    returning id into submission_id;
  else
    update public.listing_submissions
       set last_activity_at = receipt_time
     where id = submission_id;
  end if;

  insert into public.listing_submission_messages
    (listing_submission_id, meta_message_id, event_type, message_type, message_text,
     meta_media_id, sender_redacted, recipient_redacted, message_timestamp)
  values
    (submission_id, event->>'meta_message_id', event->>'event_type', event->>'message_type',
     event->>'text', event->>'meta_media_id', event->>'sender', event->>'recipient', meta_event_time)
  on conflict (meta_message_id) do nothing;
  return submission_id;
end;
$$;

create or replace function public.merge_listing_submissions(
  target_submission_id uuid,
  source_submission_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  all_ids uuid[];
  locked_count integer;
  moved_count integer;
  conversation_count integer;
  first_receipt timestamptz;
  latest_receipt timestamptz;
begin
  select array_agg(distinct id order by id) into all_ids
    from unnest(array_append(coalesce(source_submission_ids, '{}'::uuid[]), target_submission_id)) as ids(id)
   where id is not null;
  if coalesce(array_length(all_ids, 1), 0) < 2 then
    raise exception 'merge_requires_multiple_submissions';
  end if;

  -- Match ingestion's lock order (conversation, then rows), so a merge cannot
  -- race a newly received message into a source that is being removed.
  perform pg_advisory_xact_lock(hashtextextended(s.conversation_key, 0))
    from (select distinct conversation_key from public.listing_submissions
           where id = any(all_ids) order by conversation_key) s;

  -- Deterministic row locking makes concurrent merges safe and preserves rollback.
  perform 1 from public.listing_submissions
   where id = any(all_ids)
   order by id
   for update;
  get diagnostics locked_count = row_count;
  if locked_count <> array_length(all_ids, 1) then
    raise exception 'submission_not_found';
  end if;

  select count(distinct conversation_key) into conversation_count
    from public.listing_submissions where id = any(all_ids);
  if conversation_count <> 1 then
    raise exception 'conversation_mismatch';
  end if;
  if exists (
    select 1 from public.listing_submission_drafts
     where listing_submission_id = any(all_ids)
  ) then
    raise exception 'submission_has_draft';
  end if;

  update public.listing_submission_messages
     set listing_submission_id = target_submission_id
   where listing_submission_id = any(all_ids)
     and listing_submission_id <> target_submission_id;
  get diagnostics moved_count = row_count;

  select min(created_at), max(created_at)
    into first_receipt, latest_receipt
    from public.listing_submission_messages
   where listing_submission_id = target_submission_id;
  if first_receipt is null then raise exception 'submission_has_no_messages'; end if;

  update public.listing_submissions
     set started_at = first_receipt,
         last_activity_at = latest_receipt
   where id = target_submission_id;
  delete from public.listing_submissions
   where id = any(all_ids) and id <> target_submission_id;

  return jsonb_build_object('target_submission_id', target_submission_id,
                            'moved_message_count', moved_count);
end;
$$;

revoke all on function public.ingest_whatsapp_message(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ingest_whatsapp_message(jsonb) to service_role;
revoke all on function public.merge_listing_submissions(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.merge_listing_submissions(uuid,uuid[]) to service_role;

notify pgrst, 'reload schema';
