-- The linked project uses explicit service-role column privileges.
grant update(listing,updated_at) on public.team_listings to service_role;
grant update(payload) on public.public_shares to service_role;
