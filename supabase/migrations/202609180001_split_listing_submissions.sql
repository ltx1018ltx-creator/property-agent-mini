-- Transactional, retry-safe admin splits. Safe to run repeatedly.
create table if not exists public.listing_submission_split_operations (
  operation_id uuid primary key, original_submission_id uuid not null,
  new_submission_id uuid not null, selected_message_ids bigint[] not null,
  moved_message_count integer not null, created_at timestamptz not null default now()
);
alter table public.listing_submission_split_operations enable row level security;
alter table public.listing_submission_split_operations force row level security;
revoke all on public.listing_submission_split_operations from public, anon, authenticated, service_role;

create or replace function public.split_listing_submission(original_submission_id uuid, selected_message_ids bigint[], operation_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  original public.listing_submissions%rowtype; new_id uuid; normalized_ids bigint[];
  selected_count integer; total_count integer; first_receipt timestamptz; latest_receipt timestamptz;
  previous public.listing_submission_split_operations%rowtype;
begin
  if operation_id is null then raise exception 'operation_id_required'; end if;
  select array_agg(distinct id order by id) into normalized_ids from unnest(coalesce(selected_message_ids,'{}'::bigint[])) ids(id);
  if coalesce(array_length(normalized_ids,1),0)<1 then raise exception 'split_requires_selected_messages'; end if;
  select * into previous from public.listing_submission_split_operations o where o.operation_id = split_listing_submission.operation_id;
  if found then
    if previous.original_submission_id <> split_listing_submission.original_submission_id
       or previous.selected_message_ids <> normalized_ids then raise exception 'operation_id_conflict'; end if;
    return jsonb_build_object('original_submission_id',previous.original_submission_id,'new_submission_id',previous.new_submission_id,'moved_message_count',previous.moved_message_count,'duplicate',true);
  end if;
  select * into original from public.listing_submissions s where s.id=original_submission_id;
  if not found then raise exception 'submission_not_found'; end if;
  -- Serialize with webhook ingestion before locking the submission and messages.
  perform pg_advisory_xact_lock(hashtextextended(original.conversation_key,0));
  -- A concurrent retry may have committed while this transaction waited.
  select * into previous from public.listing_submission_split_operations o where o.operation_id = split_listing_submission.operation_id;
  if found then
    if previous.original_submission_id <> split_listing_submission.original_submission_id
       or previous.selected_message_ids <> normalized_ids then raise exception 'operation_id_conflict'; end if;
    return jsonb_build_object('original_submission_id',previous.original_submission_id,'new_submission_id',previous.new_submission_id,'moved_message_count',previous.moved_message_count,'duplicate',true);
  end if;
  select * into original from public.listing_submissions s where s.id=original_submission_id for update;
  if not found then raise exception 'submission_not_found'; end if;
  if exists(select 1 from public.listing_submission_drafts d where d.listing_submission_id=original_submission_id)
    then raise exception 'submission_has_draft_or_listing'; end if;
  perform 1 from public.listing_submission_messages m where m.listing_submission_id=original_submission_id order by m.id for update;
  select count(*),count(*) filter(where m.id=any(normalized_ids)) into total_count,selected_count
    from public.listing_submission_messages m where m.listing_submission_id=original_submission_id;
  if selected_count<>array_length(normalized_ids,1) then raise exception 'message_not_in_submission'; end if;
  if selected_count>=total_count then raise exception 'split_must_leave_messages'; end if;
  insert into public.listing_submissions(event_type,sender_redacted,recipient_redacted,conversation_key,started_at,last_activity_at)
    values(original.event_type,original.sender_redacted,original.recipient_redacted,original.conversation_key,original.started_at,original.last_activity_at)
    returning id into new_id;
  update public.listing_submission_messages set listing_submission_id=new_id
    where listing_submission_id=original_submission_id and id=any(normalized_ids);
  select min(created_at),max(created_at) into first_receipt,latest_receipt from public.listing_submission_messages where listing_submission_id=original_submission_id;
  update public.listing_submissions set started_at=first_receipt,last_activity_at=latest_receipt where id=original_submission_id;
  select min(created_at),max(created_at) into first_receipt,latest_receipt from public.listing_submission_messages where listing_submission_id=new_id;
  update public.listing_submissions set started_at=first_receipt,last_activity_at=latest_receipt where id=new_id;
  insert into public.listing_submission_split_operations(operation_id,original_submission_id,new_submission_id,selected_message_ids,moved_message_count)
    values(operation_id,original_submission_id,new_id,normalized_ids,selected_count);
  return jsonb_build_object('original_submission_id',original_submission_id,'new_submission_id',new_id,'moved_message_count',selected_count,'duplicate',false);
end; $$;
revoke all on function public.split_listing_submission(uuid,bigint[],uuid) from public, anon, authenticated, service_role;
grant execute on function public.split_listing_submission(uuid,bigint[],uuid) to service_role;
notify pgrst, 'reload schema';
