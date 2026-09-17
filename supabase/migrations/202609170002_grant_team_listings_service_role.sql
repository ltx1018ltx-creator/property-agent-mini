-- Allow the Phase 3B publishing RPC to read and create listings through PostgREST.
-- GRANT is idempotent and intentionally leaves the existing browser roles unchanged.
grant select, insert on table public.team_listings to service_role;

notify pgrst, 'reload schema';
