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
