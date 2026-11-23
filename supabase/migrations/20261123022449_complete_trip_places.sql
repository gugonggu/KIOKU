begin;

-- Column renames keep every saved value and the place IDs referenced by M2.
alter table public.trip_places rename column name to display_name;
alter table public.trip_places rename column address to address_text;
alter table public.trip_places
  add column name_ko text check (char_length(name_ko) <= 100),
  add column name_ja text check (char_length(name_ja) <= 100),
  add column name_en text check (char_length(name_en) <= 100),
  add column address_ja text check (char_length(address_ja) <= 240),
  add column created_at timestamptz not null default now(),
  add column provider text not null default 'MANUAL',
  add column provider_place_id text,
  add constraint trip_places_provider check (
    (provider = 'MANUAL' and provider_place_id is null)
    or (provider = 'GEOAPIFY' and provider_place_id is not null
      and char_length(provider_place_id) <= 256 and provider_place_id ~ '^[A-Za-z0-9._:-]+$'
      and latitude is not null and longitude is not null)
  );

-- Deleting a place clears the nullable reference only. The trip ID and schedule stay intact.
alter table public.itinerary_items
  drop constraint itinerary_items_trip_id_place_id_fkey,
  add constraint itinerary_items_trip_id_place_id_fkey
    foreign key (trip_id, place_id) references public.trip_places (trip_id, id) on delete set null (place_id);

create index trip_places_provider_idx on public.trip_places (trip_id, provider_place_id) where provider_place_id is not null;
grant insert (name_ko, name_ja, name_en, address_ja, provider, provider_place_id),
  update (name_ko, name_ja, name_en, address_ja, provider, provider_place_id),
  delete on public.trip_places to authenticated;

create function public.save_trip_place(
  p_trip uuid, p_id uuid, p_version integer, p_fields jsonb, p_confirm uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  input public.trip_places := jsonb_populate_record(null::public.trip_places, p_fields);
  duplicate_id uuid;
  place public.trip_places;
begin
  perform 1 from public.trips where id = p_trip for no key update;
  if not found then return jsonb_build_object('status','changed'); end if;
  select * into place from public.trip_places where trip_id = p_trip and id = p_id for update;
  if found and p_version is null then return jsonb_build_object('status','existing','id',p_id); end if;
  if p_version is not null and (place.id is null or place.content_version <> p_version) then
    return jsonb_build_object('status','changed');
  end if;
  -- Preserve repeat visits while letting an owner acknowledge a possible duplicate place.
  if p_version is null
     or (place.display_name, place.address_text, place.address_ja, place.latitude, place.longitude, place.provider_place_id)
        is distinct from (input.display_name, input.address_text, input.address_ja, input.latitude, input.longitude, input.provider_place_id)
  then
    select id into duplicate_id from public.trip_places p
      where p.trip_id = p_trip and p.id <> p_id and (
        (p.provider = 'GEOAPIFY' and input.provider = 'GEOAPIFY' and p.provider_place_id = input.provider_place_id)
        or (lower(btrim(p.display_name)) = lower(btrim(input.display_name))
          and lower(btrim(coalesce(p.address_ja,p.address_text,''))) = lower(btrim(coalesce(input.address_ja,input.address_text,'')))
          and (p.latitude,p.longitude) is not distinct from (input.latitude,input.longitude))
      ) order by id limit 1;
  end if;
  if duplicate_id is not null and duplicate_id is distinct from p_confirm then
    return jsonb_build_object('status','duplicate','id',duplicate_id);
  end if;

  if p_version is null then
    insert into public.trip_places (id,trip_id,display_name,name_ko,name_ja,name_en,address_text,address_ja,latitude,longitude,notes,provider,provider_place_id)
    values (p_id,p_trip,input.display_name,input.name_ko,input.name_ja,input.name_en,input.address_text,input.address_ja,
      input.latitude,input.longitude,input.notes,input.provider,input.provider_place_id)
    on conflict (id) do nothing;
  else
    update public.trip_places set display_name = input.display_name, name_ko = input.name_ko, name_ja = input.name_ja, name_en = input.name_en,
      address_text = input.address_text, address_ja = input.address_ja, latitude = input.latitude, longitude = input.longitude,
      notes = input.notes, provider = input.provider, provider_place_id = input.provider_place_id
      where id = p_id and trip_id = p_trip and content_version = p_version;
  end if;
  if not found then return jsonb_build_object('status','changed'); end if;
  return jsonb_build_object('status','saved','id',p_id);
end;
$$;

create function public.delete_trip_place(
  p_trip uuid, p_id uuid, p_version integer, p_expected_count integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  link_count integer;
begin
  perform 1 from public.trips where id = p_trip for no key update;
  if not found then return jsonb_build_object('status','changed'); end if;
  -- Lock the referenced key before counting, also preventing a concurrent FK insert.
  perform 1 from public.trip_places where id = p_id and trip_id = p_trip and content_version = p_version for update;
  if not found then return jsonb_build_object('status','changed'); end if;
  select count(*) into link_count from public.itinerary_items where trip_id = p_trip and place_id = p_id;
  if link_count is distinct from p_expected_count then return jsonb_build_object('status','preview','count',link_count); end if;
  delete from public.trip_places where id = p_id and trip_id = p_trip and content_version = p_version;
  if not found then return jsonb_build_object('status','changed'); end if;
  return jsonb_build_object('status','deleted');
end;
$$;

create schema kioku_private;
revoke all on schema kioku_private from public, anon, authenticated;
create table kioku_private.place_search_budget (
  scope text primary key,
  window_start timestamptz not null,
  calls integer not null check (calls > 0)
);
revoke all on kioku_private.place_search_budget from public, anon, authenticated;

-- This RPC writes only quota counters. Its explicit ownership guard also covers invocations via the Data API.
create function public.authorize_place_search(p_trip uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  minute_window timestamptz := date_trunc('minute', statement_timestamp());
  day_window timestamptz := date_trunc('day', statement_timestamp(), 'UTC');
begin
  if actor is null or auth.jwt()->>'is_anonymous' = 'true'
     or not exists (select 1 from public.trips where id = p_trip and owner_id = actor) then return false; end if;
  insert into kioku_private.place_search_budget as budget values ('owner:' || actor, minute_window, 1)
    on conflict (scope) do update set window_start = excluded.window_start,
      calls = case when budget.window_start = excluded.window_start then budget.calls + 1 else 1 end
    where budget.window_start < excluded.window_start or (budget.window_start = excluded.window_start and budget.calls < 10);
  if not found then return false; end if;
  insert into kioku_private.place_search_budget as budget values ('project', day_window, 1)
    on conflict (scope) do update set window_start = excluded.window_start,
      calls = case when budget.window_start = excluded.window_start then budget.calls + 1 else 1 end
    where budget.window_start < excluded.window_start or (budget.window_start = excluded.window_start and budget.calls < 100);
  return found;
end;
$$;

revoke execute on function public.save_trip_place(uuid,uuid,integer,jsonb,uuid),
  public.delete_trip_place(uuid,uuid,integer,integer), public.authorize_place_search(uuid) from public, anon, authenticated;
grant execute on function public.save_trip_place(uuid,uuid,integer,jsonb,uuid),
  public.delete_trip_place(uuid,uuid,integer,integer), public.authorize_place_search(uuid) to authenticated;

commit;
