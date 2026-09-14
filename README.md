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
