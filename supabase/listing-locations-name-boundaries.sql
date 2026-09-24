create or replace function public.resolve_listing_area_internal(place text,agent uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare k text:=public.location_key(place); matched text; matches text[];
begin
 if k='' then return '';end if;
 select r.area into matched from public.listing_location_rules r where r.owner_id=agent and r.place_key=k;
 if found then return matched;end if;
 -- Cheng Ho is a name, not the Cheng filter area. Leave it for confirmation.
 if position(' cheng ho ' in ' '||k||' ')>0 then return '';end if;
 -- The user's explicitly confirmed mapping, also recognizing Tmn / Sri spelling.
 if k in ('taman seri songket','seri songket') then return 'Batu Berendam';end if;
 select a.name into matched from public.listing_areas a where public.location_key(a.name)=k;
 if found then return matched;end if;
 -- Only read the location field, never marketing prose such as "nearby Cheng".
 if k ~ '\m(near|nearby|minutes|min|close|berdekatan)\M' then return '';end if;
 select array_agg(a.name) into matches from public.listing_areas a
 where position(' '||public.location_key(a.name)||' ' in ' '||k||' ')>0
 and not exists(select 1 from public.listing_areas b where b.name<>a.name
   and position(' '||public.location_key(b.name)||' ' in ' '||k||' ')>0
   and position(' '||public.location_key(a.name)||' ' in ' '||public.location_key(b.name)||' ')>0);
 if array_length(matches,1)=1 then return matches[1];end if;
 return '';
end $$;

