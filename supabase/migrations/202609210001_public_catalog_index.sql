-- Supports the public catalog's owner-isolated keyset pagination.
-- CREATE INDEX IF NOT EXISTS is safe to run again during deployment.
create index if not exists team_listings_owner_created_id_idx
  on public.team_listings (owner_id, created_at desc, id);
