-- Preserve the original place; derive a separate, conservative filter area.
begin;
create table public.listing_areas(name text primary key);
insert into public.listing_areas(name) select unnest(array[
 'Alai','Alor Gajah','Ayer Keroh','Ayer Molek','Ayer Pa''abas','Bachang','Bandar Hilir','Batang Melaka','Batu Berendam','Belimbing','Bemban','Bertam','Brisu','Bukit Baru','Bukit Beruang','Bukit Katil','Bukit Lintang','Bukit Piatu','Bukit Rambai','Bukit Serindit','Cheng','Durian Tunggal','Duyong','Jasin','Jonker Walk','Kandang','Klebang','Kota Laksamana','Krubong','Lendu','Limbongan','Lubok China','Machap','Malim','Malim Jaya','Masjid Tanah','Melaka Baru','Melaka City','Melaka Raya','Melaka Tengah','Merlimau','MITC','Nyalas','Padang Temu','Pantai Kundor','Paya Dalam','Paya Rumput','Pengkalan Balak','Pertam Jaya','Pokok Mangga','Pulau Gadong','Pulau Sebang','Rembia','Selandar','Semabok','Simpang Ampat','Sungai Udang','Tanjung Bidara','Tanjung Kling','Tanjung Minyak','Telok Mas','Tengkera','Tiang Dua','Ujong Pasir','Umbai']);
alter table public.listing_areas enable row level security;
revoke all on public.listing_areas from public,anon,authenticated;
grant select on public.listing_areas to anon,authenticated;
create policy areas_read on public.listing_areas for select to anon,authenticated using(true);

create function public.location_key(value text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(value,'')),'\mtmn\M','taman','g'),'\msri\M','seri','g'),'[^a-z0-9]+',' ','g'))
$$;
revoke all on function public.location_key(text) from public;
grant execute on function public.location_key(text) to authenticated;

create table public.listing_location_rules(
 owner_id uuid not null references auth.users(id) on delete cascade,
 place_key text not null check(length(place_key) between 3 and 200),
 place_name text not null check(length(place_name) between 3 and 200),
 area text not null references public.listing_areas(name),
 updated_at timestamptz not null default now(),
 primary key(owner_id,place_key)
);
alter table public.listing_location_rules enable row level security;
revoke all on public.listing_location_rules from public,anon,authenticated;
grant select on public.listing_location_rules to authenticated;
create policy own_location_rules on public.listing_location_rules for select to authenticated
 using(owner_id=(select auth.uid()) and (select public.is_workspace_member()));
grant all on public.listing_areas,public.listing_location_rules to service_role;

-- Internal resolver: no callable API that could probe another member's rules.
create function public.resolve_listing_area_internal(place text,agent uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare k text:=public.location_key(place); matched text; matches text[];
begin
 if k='' then return '';end if;
 select r.area into matched from public.listing_location_rules r where r.owner_id=agent and r.place_key=k;
 if found then return matched;end if;
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
revoke all on function public.resolve_listing_area_internal(text,uuid) from public,anon,authenticated;

create function public.preview_listing_area(place text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare area text;
begin
 if auth.uid() is null or not public.is_workspace_member() then raise exception 'Active membership required' using errcode='42501';end if;
 if length(place)>200 then raise exception 'Location must be at most 200 characters';end if;
 area:=public.resolve_listing_area_internal(place,auth.uid());
 return jsonb_build_object('area',area,'status',case when area='' then 'review' else 'auto' end);
end $$;
revoke all on function public.preview_listing_area(text) from public,anon,authenticated;
grant execute on function public.preview_listing_area(text) to authenticated;

create function public.assign_listing_area() returns trigger
language plpgsql security definer set search_path='' as $$
declare area text; mode text:=coalesce(new.listing->>'locationMode','auto');
begin
 if mode='manual' then
   area:=new.listing->>'locationArea';
   if not exists(select 1 from public.listing_areas where name=area) then raise exception 'Choose a valid filter area';end if;
 else
   mode:='auto';area:=public.resolve_listing_area_internal(new.listing->>'location',new.owner_id);
 end if;
 new.listing:=new.listing||jsonb_build_object('locationArea',area,'locationMode',mode,'locationStatus',case when area='' then 'review' else mode end);
 new.updated_at:=now();
 return new;
end $$;
revoke all on function public.assign_listing_area() from public,anon,authenticated;
create trigger assign_listing_area before insert or update of listing on public.team_listings
 for each row execute function public.assign_listing_area();

create function public.remember_listing_area(place text,area text) returns integer
language plpgsql security definer set search_path='' as $$
declare k text:=public.location_key(place); changed integer;
begin
 if auth.uid() is null or not public.is_workspace_member() then raise exception 'Active membership required' using errcode='42501';end if;
 if place is null or length(trim(place)) not between 3 and 200 or length(k)<3 then raise exception 'Enter a specific development name';end if;
 if not exists(select 1 from public.listing_areas a where a.name=area) then raise exception 'Choose a valid filter area';end if;
 insert into public.listing_location_rules(owner_id,place_key,place_name,area) values(auth.uid(),k,trim(place),area)
 on conflict(owner_id,place_key) do update set place_name=excluded.place_name,area=excluded.area,updated_at=now();
 -- Preserve individually overridden records and never modify another owner's records.
 update public.team_listings t set listing=t.listing where t.owner_id=auth.uid()
 and public.location_key(t.listing->>'location')=k and coalesce(t.listing->>'locationMode','auto')<>'manual';
 get diagnostics changed=row_count;return changed;
end $$;
revoke all on function public.remember_listing_area(text,text) from public,anon,authenticated;
grant execute on function public.remember_listing_area(text,text) to authenticated;
commit;

