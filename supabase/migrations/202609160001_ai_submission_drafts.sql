-- Phase 3A private AI-assisted drafts. Safe to run repeatedly.
create extension if not exists pgcrypto;

create table if not exists public.listing_submission_drafts (
  id uuid primary key default gen_random_uuid(),
  listing_submission_id uuid not null references public.listing_submissions(id) on delete cascade,
  structured_data jsonb,
  marketing_copy text,
  status text not null default 'pending' check (status in ('pending','generated','needs_review','approved','rejected','failed')),
  model_name text,
  prompt_version text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_submission_id, prompt_version)
);

alter table public.listing_submission_drafts enable row level security;
alter table public.listing_submission_drafts force row level security;
revoke all on public.listing_submission_drafts from anon, authenticated, service_role;
grant select, insert, update on public.listing_submission_drafts to service_role;

create or replace function public.touch_listing_submission_draft_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end $$;
drop trigger if exists touch_listing_submission_draft_updated_at on public.listing_submission_drafts;
create trigger touch_listing_submission_draft_updated_at before update on public.listing_submission_drafts
for each row execute function public.touch_listing_submission_draft_updated_at();
revoke all on function public.touch_listing_submission_draft_updated_at() from public,anon,authenticated;

create or replace function public.claim_listing_submission_draft(
  submission_id uuid, requested_prompt_version text, requested_model text, regenerate boolean default false)
returns jsonb
language plpgsql security invoker set search_path=public as $$
declare draft public.listing_submission_drafts; affected integer; did_claim boolean;
begin
  if not exists (select 1 from public.listing_submissions where id=submission_id) then
    raise exception 'submission_not_found';
  end if;
  insert into public.listing_submission_drafts(listing_submission_id,prompt_version,model_name,status)
  values(submission_id,requested_prompt_version,requested_model,'pending')
  on conflict (listing_submission_id,prompt_version) do update
    set status='pending', structured_data=null, marketing_copy=null, error_code=null,
        model_name=excluded.model_name, updated_at=now()
    -- A normal request never takes over an existing attempt. Explicit retries
    -- may immediately replace a finished attempt, but an in-flight attempt is
    -- protected for 15 minutes before it can be reclaimed. The conflict update
    -- is atomic, so simultaneous retry clicks cannot both acquire the draft.
    where regenerate and (
      public.listing_submission_drafts.status <> 'pending'
      or public.listing_submission_drafts.updated_at < now() - interval '15 minutes'
    );
  get diagnostics affected = row_count;
  did_claim := affected > 0;
  select * into draft from public.listing_submission_drafts
   where listing_submission_id=submission_id and prompt_version=requested_prompt_version;
  return jsonb_build_object('claimed',did_claim,'draft',to_jsonb(draft));
end $$;

revoke all on function public.claim_listing_submission_draft(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_listing_submission_draft(uuid,text,text,boolean) to service_role;
notify pgrst, 'reload schema';
