-- Anonymous visit summaries for the owner dashboard. No IP address or identity is collected.
create function public.get_recent_site_visits(days integer default 7)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if auth.uid() is distinct from '6c8e4545-3e89-40e2-b5a9-7a18475641d7'::uuid or not public.is_admin() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if days is null or days not in (7, 30, 90) then
    raise exception 'Choose 7, 30 or 90 days';
  end if;
  return (
    with recent as materialized (
      select visit_id, recorded_at, event_name, listing_title, device_type, source_category
      from public.site_analytics_events
      where recorded_at >= (today - (days - 1))::timestamp at time zone 'Asia/Kuala_Lumpur'
        and recorded_at < (today + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    ), visits as (
      select visit_id, max(recorded_at) last_seen,
        (array_agg(device_type order by recorded_at))[1] device,
        (array_agg(source_category order by recorded_at))[1] source,
        count(*) filter (where event_name = 'page_view') page_views,
        count(*) filter (where event_name = 'whatsapp_click') whatsapp_clicks
      from recent group by visit_id order by last_seen desc limit 20
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'last_seen', v.last_seen, 'device', v.device, 'source', v.source,
      'page_views', v.page_views, 'whatsapp_clicks', v.whatsapp_clicks,
      'properties', coalesce((
        select jsonb_agg(p.listing_title order by p.listing_title)
        from (select distinct nullif(e.listing_title, '') listing_title from recent e
          where e.visit_id = v.visit_id and e.event_name = 'listing_view'
            and e.listing_title <> '' limit 4) p
      ), '[]'::jsonb)
    ) order by v.last_seen desc), '[]'::jsonb) from visits v
  );
end $$;
revoke all on function public.get_recent_site_visits(integer) from public, anon, authenticated;
grant execute on function public.get_recent_site_visits(integer) to authenticated;

