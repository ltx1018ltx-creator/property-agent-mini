# Property Agent Hub

Mobile-first mini app for a Melaka property agent. v17 keeps an offline browser copy and syncs leads, listings and cases to the included server API. The server stores shared listings in `shares.json` and workspace state in `agent-state.json`.

Run locally:

```bash
cd property-agent-mini
python3 server.py
```

Open `http://localhost:8080`.

## WhatsApp ingestion (Phase 1)

Ingestion is off by default. To deploy it safely:

1. In the Supabase dashboard, open **SQL Editor**, paste the complete contents of
   `supabase/migrations/202609140001_whatsapp_ingestion_phase1.sql`, and select
   **Run**. Running the migration again is safe.
2. Confirm the server already has `META_APP_SECRET` and a server-only
   `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Never paste or expose
   their values in client code, logs, screenshots, or support messages.
3. Set `WHATSAPP_INGESTION_ENABLED=true` on the server and redeploy. Leave it
   unset or set it to `false` to disable writes immediately.
4. Optionally set the server-only `WHATSAPP_ALLOWED_CONVERSATION_KEY` to the
   selected submission's 64-character lowercase hexadecimal `conversation_key`.
   When configured, only that direction-independent conversation is ingested,
   including both normal messages and `smb_message_echoes`. Keep the value out
   of client code and logs. An absent value preserves the existing behavior; a
   malformed value fails closed and prevents all WhatsApp ingestion.

The Phase 1 handler stores text/captions and Meta media IDs only. It does not
download media, invoke OpenAI, or create `team_listings` records.

## WhatsApp private image ingestion (Phase 2)

Phase 2 is independently opt-in and remains disabled unless
`WHATSAPP_MEDIA_INGESTION_ENABLED` is exactly `true`. It supports JPEG, PNG, and
WebP images up to 15 MB. Images are placed in the private
`whatsapp-ingestion` Supabase Storage bucket under non-identifying UUID paths;
the browser roles have no access to that bucket.

Deployment steps:

1. Keep `WHATSAPP_MEDIA_INGESTION_ENABLED` unset or set to `false` while
   deploying the code.
2. Run `supabase/migrations/202609140002_whatsapp_media_ingestion.sql` in the
   Supabase SQL Editor. The migration is idempotent and also makes the bucket
   private if it already exists.
3. Add `WHATSAPP_ACCESS_TOKEN` to the server's secret environment settings.
   It must be a valid server-side Meta token with permission to retrieve the
   media received by the configured WhatsApp Business account. Never expose it
   to browser code or operational logs.
4. Confirm `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) remains
   server-only, then set `WHATSAPP_MEDIA_INGESTION_ENABLED=true` and redeploy.
5. Send one test image and verify its message has `media_status = 'stored'` and
   an object exists in the private bucket. Do not make the bucket public to
   inspect it.

Media retrieval is best-effort after the Phase 1 message transaction. Safe
statuses are `pending`, `stored`, `rejected`, and `failed`; only fixed error
codes are persisted. A failed media request therefore does not remove or alter
the already stored message. The feature does not call AI or write to
`team_listings`.

## Atomic WhatsApp grouping and manual merge

Deploy the application, then run
`supabase/migrations/202609170003_atomic_whatsapp_grouping_and_merge.sql` in the
Supabase SQL Editor. The idempotent migration backfills a direction-independent
conversation key, replaces ingestion with a transaction-level advisory lock and
a rolling five-minute server-receipt window, and installs the service-role-only
merge RPC. Meta timestamps remain message metadata but no longer decide which
active submission receives an out-of-order delivery.

Verification:

1. Send text and several images concurrently in both webhook delivery
   directions and verify that one ungenerated submission contains every unique
   Meta message ID.
2. Replay a webhook and verify its message count does not change. Send another
   message just under five minutes after the prior receipt and verify it extends
   the same submission; after five inactive minutes, verify a new submission is
   created.
3. Verify two different WhatsApp conversations never group together and that a
   generated, reviewed, or published submission never receives new messages.
4. In **WhatsApp Draft Inbox**, select two or more ungenerated submissions from
   one conversation, click **Merge Submissions**, and confirm. Verify all text
   and stored images appear once under the first selection and the empty source
   rows are gone.
5. Verify a non-admin request is rejected, and try a cross-conversation or
   generated selection to confirm the entire merge rolls back unchanged.

The server logs only the selected submission count and fixed failure metadata;
it never logs phone numbers, Meta identifiers, message text, tokens, or private
Storage paths.

## AI-assisted submission drafts (Phase 3A)

Phase 3A adds a private, admin-only review inbox. It never publishes a listing
and never inserts or updates `team_listings`. An authenticated admin must click
**Generate AI Draft** before any OpenAI request is made. Images remain private
and are shown through five-minute signed URLs; image contents are not sent to
OpenAI. Only stored WhatsApp property text is sent, without sender/recipient
identifiers, phone numbers, Meta IDs, tokens, or Storage paths.

Deployment:

1. Keep `AI_DRAFT_ENABLED=false` while deploying.
2. Run `supabase/migrations/202609160001_ai_submission_drafts.sql` in the
   Supabase SQL Editor. It is idempotent, enables and forces RLS, denies browser
   roles, and grants only required server-role table/function privileges.
3. Set server-only `OPENAI_API_KEY` and `OPENAI_MODEL` environment variables.
   Do not add either to browser JavaScript or log their values.
4. Confirm `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is configured,
   then set `AI_DRAFT_ENABLED=true` and redeploy.
5. Sign in as a user listed in `admin_users`, open **Admin**, generate a draft,
   edit it, and approve or reject it. There is intentionally no Publish action.

The server uses the OpenAI Responses API with a strict JSON Schema. Duplicate
clicks reuse the active `(listing_submission_id, prompt_version)` draft; an
explicit confirmed regenerate starts a new attempt for that same record.
Operational logs contain fixed status/error codes only, never prompts, property
text, credentials, or identifiers.

## Publishing approved drafts (Phase 3B)

Phase 3B remains fully manual: after reviewing and approving a draft, an admin
must separately click **Publish Listing** and confirm. The server allow-lists the
existing listing fields, maps `marketing_copy` to the existing `rawText` field,
and puts public image URLs in the existing `photos` array. Stored submission
images are copied to the public `listing-images` bucket using deterministic
object names; the original `whatsapp-ingestion` bucket and objects stay private
and are never returned as listing URLs.

Deployment and verification:

1. Deploy the application code, but do not publish until the database migration
   is complete. AI generation remains controlled independently by
   `AI_DRAFT_ENABLED` and is never triggered by publishing.
2. Run `supabase/migrations/202609170001_publish_approved_listings.sql` in the
   Supabase SQL Editor. It is idempotent and adds publication tracking, the
   public listing-image bucket/read policy, restrictive browser write-deny
   policies, an immutable-published-draft guard,
   and the atomic publishing function.
3. Confirm the server-only Supabase service-role secret is configured. No new
   browser secret or feature flag is required.
4. As an admin, approve a test draft, click **Publish Listing**, review the
   confirmation, and publish. Verify exactly one `team_listings` row exists,
   `published_listing_id` and `published_at` are set, every successfully stored
   image is visible on the listing, and the listing contains no
   `whatsapp-ingestion` URL or path.
5. Click Publish again (or replay the request) and verify it returns the same
   listing ID without creating another row. Also verify a non-approved draft is
   rejected and remains unchanged.

Publishing failures leave the approved draft and all original private images in
place for a safe retry. A failed copy may leave deterministic public objects;
the retry safely overwrites those same names and cannot create a duplicate
listing because the final database function locks the draft and commits the
listing plus tracking atomically.

### Phase 3B rollback

First stop using the Publish action by rolling the application back. Existing
published `team_listings` are normal website listings and are intentionally not
deleted. After any required image retention/export, run:

```sql
begin;
drop function if exists public.publish_approved_listing(uuid,uuid,jsonb);
drop trigger if exists prevent_published_draft_changes on public.listing_submission_drafts;
drop function if exists public.prevent_published_draft_changes();
drop index if exists public.listing_submission_drafts_published_listing_unique;
alter table public.listing_submission_drafts
  drop column if exists published_at,
  drop column if exists published_listing_id;
drop policy if exists listing_images_public_read on storage.objects;
drop policy if exists listing_images_anon_authenticated_insert_deny on storage.objects;
drop policy if exists listing_images_anon_authenticated_update_deny on storage.objects;
drop policy if exists listing_images_anon_authenticated_delete_deny on storage.objects;
-- Only after confirming no retained listing references these objects:
delete from storage.objects where bucket_id='listing-images';
delete from storage.buckets where id='listing-images';
commit;
```

Run all tests with:

```bash
python3 -m unittest discover -v
```

### Phase 3A rollback

First set `AI_DRAFT_ENABLED=false` and redeploy. After completing any required
retention/export process, remove only Phase 3A data and functions (this is
permanent and does not affect Phase 1/2 or `team_listings`):

```sql
begin;
drop function if exists public.claim_listing_submission_draft(uuid,text,text,boolean);
drop table if exists public.listing_submission_drafts;
drop function if exists public.touch_listing_submission_draft_updated_at();
commit;
```

### Phase 2 rollback

First set `WHATSAPP_MEDIA_INGESTION_ENABLED=false` and redeploy; this immediately
stops new downloads while leaving Phase 1 ingestion operational. To remove the
Phase 2 database additions and all downloaded images, run the following only
after any required retention/export process (the object deletion is permanent):

```sql
begin;
drop policy if exists whatsapp_ingestion_anon_deny on storage.objects;
drop policy if exists whatsapp_ingestion_authenticated_deny on storage.objects;
delete from storage.objects where bucket_id = 'whatsapp-ingestion';
delete from storage.buckets where id = 'whatsapp-ingestion';
drop trigger if exists set_whatsapp_media_pending on public.listing_submission_messages;
drop function if exists public.set_whatsapp_media_pending();
drop function if exists public.claim_whatsapp_image(text);
drop function if exists public.finish_whatsapp_image(text,text,text,bigint,text);
alter table public.listing_submission_messages
  drop column if exists media_storage_bucket,
  drop column if exists media_storage_path,
  drop column if exists media_mime_type,
  drop column if exists media_size_bytes,
  drop column if exists media_status,
  drop column if exists media_error_code,
  drop column if exists media_processing_at;
commit;
```

### Manual rollback

First set `WHATSAPP_INGESTION_ENABLED=false` and redeploy. Then run the following
in the Supabase SQL Editor (this permanently deletes Phase 1 ingestion data):

```sql
begin;
drop function if exists public.ingest_whatsapp_message(jsonb);
drop table if exists public.listing_submission_messages;
drop table if exists public.listing_submissions;
commit;
```

For production, run this server behind HTTPS with authentication and persistent storage. A `trycloudflare.com` quick tunnel is for temporary previews only and does not provide a fixed hostname or uptime guarantee.

## Splitting an incorrectly grouped submission

1. Run `supabase/migrations/202609180001_split_listing_submissions.sql` in the
   Supabase SQL editor after the WhatsApp, draft, and atomic-grouping migrations.
   The migration is safe to run repeatedly.
2. Sign in as an admin and open **Admin → WhatsApp Draft Inbox**. **Split
   Submission** appears only when an ungenerated submission has two or more items.
3. Select the text messages and image rows for the new property, click **Review
   split**, and confirm. At least one item must move and one must remain.
4. Refresh and verify both submissions. Only message rows move; stored image
   objects and their private references are neither copied nor deleted. Retrying
   the same confirmed operation is safe.

The function uses the webhook's per-conversation advisory lock, locks the source
and messages, rejects submissions with a draft (including a published listing),
and recalculates both activity ranges in one transaction. The admin-only HTTP
route logs only counts, booleans, fixed codes, and exception classes—never text,
phone numbers, Meta IDs, storage paths, tokens, or secrets.
