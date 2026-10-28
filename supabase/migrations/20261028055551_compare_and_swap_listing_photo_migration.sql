-- Applied remotely before the image migration release. No browser grants.
create or replace function public.replace_embedded_listing_images(
  source_table text, record_id uuid, expected jsonb, replacement jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if source_table='team_listings' then
    update public.team_listings set listing=replacement,updated_at=now()
      where id=record_id and listing=expected;
  elsif source_table='public_shares' then
    update public.public_shares set payload=replacement
      where id=record_id and payload=expected;
  else raise exception 'Unsupported migration source'; end if;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.replace_embedded_listing_images(text,uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.replace_embedded_listing_images(text,uuid,jsonb,jsonb)
  to service_role;
