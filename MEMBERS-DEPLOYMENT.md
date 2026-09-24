# Invite-only private workspaces

This change is staged for the existing Render/Supabase app. Apply the database
migration **before** deploying the UI; without it, the new login gate fails closed.

1. Confirm the owner account is already in `public.admin_users`. The migration
   refuses to continue if that table has no administrator. Do not add other
   administrators: this app's Admin role is intended for Tong Xen.
2. Apply `supabase/migrations/202609230001_invite_only_private_workspaces.sql`.
   It is transactional and rerunnable. Existing admins and users previously
   invited by email start active. Other existing users start pending and can
   be approved individually in Members. No clients, cases, or listings are deleted.
3. Run `tests/workspace-permissions.sql` in the same SQL Editor. It creates
   synthetic accounts inside a transaction and rolls everything back. Also
   review any additional live database policies/functions absent from this repo.
4. Disable public sign-ups in Supabase Auth settings as an additional explicit
   configuration. The migration also rejects non-invited new Auth users at
   database level and ignores user-editable role metadata.
5. Verify Render's server-only Supabase secret and `SITE_URL` for the service
   being deployed. This repo's blueprint names `mari-property`, while the user
   supplied `property-agent-mini.onrender.com`; verify the intended service in
   Render rather than assuming both deployments auto-update. Allow its HTTPS
   invitation redirect URL in Supabase Auth URL Configuration. Verify SMTP.
6. Deploy the tested commit, sign in as the owner, then invite only an explicitly
   approved recipient. Test activation, shared listings, private clients/cases,
   suspension, and reactivation with separate test users before inviting a team.

## Resulting access

- Admin manages account invitations, approval, suspension and reactivation.
- Every account, including Admin, reads/writes only its own private workspace.
- Active members read shared listings; only the listing owner edits/deletes it.
- Admin cannot view other agents' client/case counts or records.
- Generated copy uses each agent's saved contact profile; profile data is private.
- Suspension blocks database access immediately and revokes that member's import
  key. The UI rechecks membership every 30 seconds and when the tab regains focus.
- Public property catalog and already-published listing shares retain their
  existing public access. Suspension does not unpublish existing listings.
- The unauthenticated legacy `/api/state` route returns 410 without accessing its
  old file. Private API responses are no longer put in service-worker caches.

## Validation / rollback

Run `node --test tests/*.test.js` and `python3 -m unittest discover -q`.
Windows tests require UTF-8 mode and the local Python interpreter in place of
the Render command's `python3` executable.

Use a staging database for migration validation where available. Do not rerun
the older `admin-setup.sql` or `team-listings-upgrade.sql` after this migration:
they recreate the former private-data Admin RPC. If those scripts are needed,
apply this migration again last. Do not roll back to code that recreates those
RPCs; roll forward or restore a reviewed database backup instead.

No real invitation email is sent by automated tests. Mocked browser checks
validate UI flows only; the SQL test and live deployment checks are required
before claiming production access isolation is verified.
