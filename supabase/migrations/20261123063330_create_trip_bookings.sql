begin;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('FLIGHT','STAY','TOUR')),
  title text not null check (char_length(title) <= 100 and title ~ '[^[:space:]]'),
  status text not null check (status in ('NEEDS_BOOKING','PENDING','CONFIRMED','CANCELLED')),
  shared_note text check (char_length(shared_note) <= 1500),
  content_version integer not null default 1 check (content_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, id),
  unique (trip_id, id, kind)
);
create trigger bookings_set_revision before update on public.bookings
  for each row execute function public.set_trip_revision();

create table public.flight_segments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  booking_id uuid not null,
  kind text generated always as ('FLIGHT'::text) stored,
  segment_order integer not null check (segment_order between 1 and 20),
  airline_name text check (char_length(airline_name) <= 100),
  flight_number text check (char_length(flight_number) <= 20),
  departure_airport text check (departure_airport ~ '^[A-Z0-9]{3,4}$'),
  arrival_airport text check (arrival_airport ~ '^[A-Z0-9]{3,4}$'),
  departure_local_date date check (departure_local_date between date '0001-01-01' and date '9999-12-31'),
  arrival_local_date date check (arrival_local_date between date '0001-01-01' and date '9999-12-31'),
  departure_local_time time(0) check (departure_local_time < time '24:00' and extract(second from departure_local_time) = 0),
  arrival_local_time time(0) check (arrival_local_time < time '24:00' and extract(second from arrival_local_time) = 0),
  departure_timezone text,
  arrival_timezone text,
  departure_utc timestamptz,
  arrival_utc timestamptz,
  unique (trip_id, booking_id, segment_order),
  foreign key (trip_id, booking_id, kind) references public.bookings (trip_id, id, kind) on delete cascade
);
create table public.stay_details (
  booking_id uuid primary key,
  trip_id uuid not null,
  kind text generated always as ('STAY'::text) stored,
  property_name text not null check (char_length(property_name) <= 100 and property_name ~ '[^[:space:]]'),
  address_text text check (char_length(address_text) <= 300),
  check_in_local_date date check (check_in_local_date between date '0001-01-01' and date '9999-12-31'),
  check_out_local_date date check (check_out_local_date between date '0001-01-01' and date '9999-12-31'),
  check_in_local_time time(0) check (check_in_local_time < time '24:00' and extract(second from check_in_local_time) = 0),
  check_out_local_time time(0) check (check_out_local_time < time '24:00' and extract(second from check_out_local_time) = 0),
  guest_count integer check (guest_count between 1 and 999),
  room_count integer check (room_count between 1 and 999),
  check (check_out_local_date >= check_in_local_date),
  foreign key (trip_id, booking_id, kind) references public.bookings (trip_id, id, kind) on delete cascade
);
create table public.tour_details (
  booking_id uuid primary key,
  trip_id uuid not null,
  kind text generated always as ('TOUR'::text) stored,
  event_local_date date check (event_local_date between date '0001-01-01' and date '9999-12-31'),
  event_local_time time(0) check (event_local_time < time '24:00' and extract(second from event_local_time) = 0),
  meeting_local_time time(0) check (meeting_local_time < time '24:00' and extract(second from meeting_local_time) = 0),
  meeting_place_name text check (char_length(meeting_place_name) <= 100),
  meeting_address_text text check (char_length(meeting_address_text) <= 300),
  meeting_latitude double precision,
  meeting_longitude double precision,
  check ((meeting_latitude is null and meeting_longitude is null) or
    (meeting_latitude is not null and meeting_longitude is not null and
     meeting_latitude between -90 and 90 and meeting_longitude between -180 and 180)),
  foreign key (trip_id, booking_id, kind) references public.bookings (trip_id, id, kind) on delete cascade
);
create table public.booking_private_details (
  booking_id uuid primary key,
  trip_id uuid not null,
  confirmation_reference text check (char_length(confirmation_reference) <= 100),
  amount numeric check (amount between 0 and 999999999999.99 and scale(amount) <= 2),
  currency text check (currency ~ '^[A-Z]{3}$'),
  private_note text check (char_length(private_note) <= 1500),
  check ((amount is null) = (currency is null)),
  foreign key (trip_id, booking_id) references public.bookings (trip_id, id) on delete cascade
);
create index stay_details_trip_idx on public.stay_details (trip_id);
create index tour_details_trip_idx on public.tour_details (trip_id);

-- Derive UTC only when PostgreSQL can resolve the recorded wall clock uniquely.
create function public.flight_local_to_utc(local_day date, local_time time, zone text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  wall timestamp := local_day + local_time;
  guess timestamptz;
begin
  if zone is null then return null; end if;
  if char_length(zone) > 64 or not exists (select 1 from pg_catalog.pg_timezone_names where name = zone) then
    raise exception 'Unsupported flight time zone' using errcode = '22023';
  end if;
  if wall is null then return null; end if;
  guess := wall at time zone zone;
  return (
    select case when count(*) = 1 then min(candidate) end
    from (
      select distinct guess + ((sample at time zone 'UTC') - (sample at time zone zone))
          - ((guess at time zone 'UTC') - (guess at time zone zone)) as candidate
      from (values (guess - interval '24 hours'), (guess), (guess + interval '24 hours')) as offsets(sample)
    ) candidates
    where candidate at time zone zone = wall
  );
end;
$$;

create function public.set_flight_utc() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.departure_utc := public.flight_local_to_utc(new.departure_local_date, new.departure_local_time, new.departure_timezone);
  new.arrival_utc := public.flight_local_to_utc(new.arrival_local_date, new.arrival_local_time, new.arrival_timezone);
  return new;
end;
$$;
create trigger flight_segments_set_utc before insert or update on public.flight_segments
  for each row execute function public.set_flight_utc();
revoke execute on function public.flight_local_to_utc(date, time, text), public.set_flight_utc() from public, anon, authenticated;
grant execute on function public.flight_local_to_utc(date, time, text) to authenticated;

do $$
declare
  relation text;
begin
  foreach relation in array array['bookings','flight_segments','stay_details','tour_details','booking_private_details'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select, delete on public.%I to authenticated', relation);
    execute format('create policy booking_trip_owner on public.%1$I for all to authenticated
      using (exists (select 1 from public.trips where id = %1$I.trip_id and owner_id = (select auth.uid())))
      with check (exists (select 1 from public.trips where id = %1$I.trip_id and owner_id = (select auth.uid())))', relation);
  end loop;
end;
$$;
grant insert (id, trip_id, kind, title, status, shared_note), update (title, status, shared_note)
  on public.bookings to authenticated;
grant insert (trip_id, booking_id, segment_order, airline_name, flight_number,
  departure_airport, arrival_airport, departure_local_date, arrival_local_date,
  departure_local_time, arrival_local_time, departure_timezone, arrival_timezone)
  on public.flight_segments to authenticated;
grant insert (trip_id, booking_id, property_name, address_text, check_in_local_date, check_out_local_date,
  check_in_local_time, check_out_local_time, guest_count, room_count) on public.stay_details to authenticated;
grant insert (trip_id, booking_id, event_local_date, event_local_time, meeting_local_time, meeting_place_name,
  meeting_address_text, meeting_latitude, meeting_longitude) on public.tour_details to authenticated;
grant insert (trip_id, booking_id, confirmation_reference, amount, currency, private_note)
  on public.booking_private_details to authenticated;

alter table public.itinerary_items
  drop constraint itinerary_booking_pending,
  add constraint itinerary_booking_same_trip foreign key (trip_id, booking_id)
    references public.bookings (trip_id, id) on delete set null (booking_id),
  add constraint itinerary_booking_reference check (kind <> 'BOOKING_REF' or booking_id is not null);
create index itinerary_items_booking_idx on public.itinerary_items (trip_id, booking_id) where booking_id is not null;
grant insert (booking_id), update (booking_id) on public.itinerary_items to authenticated;

create function public.detach_itinerary_booking() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- A booking-reference entry becomes an ordinary note when its booking disappears.
  if old.booking_id is not null and new.booking_id is null and new.kind = 'BOOKING_REF' then
    new.kind := 'NOTE';
  end if;
  return new;
end;
$$;
revoke execute on function public.detach_itinerary_booking() from public, anon, authenticated;
create trigger itinerary_items_detach_booking before update of booking_id on public.itinerary_items
  for each row execute function public.detach_itinerary_booking();

create function public.save_booking(p_trip uuid, p_id uuid, p_version integer, p_fields jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  input public.bookings := jsonb_populate_record(null::public.bookings, p_fields);
  detail jsonb := p_fields->'detail';
begin
  -- Use the same parent lock as itinerary writers.
  perform 1 from public.trips where id = p_trip for no key update;
  if not found then return 'changed'; end if;

  if p_version is null then
    insert into public.bookings (id, trip_id, kind, title, status, shared_note)
      values (p_id, p_trip, input.kind, input.title, input.status, input.shared_note) on conflict (id) do nothing;
    if not found then
      if exists (select 1 from public.bookings where trip_id = p_trip and id = p_id) then return 'existing'; end if;
      return 'changed';
    end if;
  else
    update public.bookings set title = input.title, status = input.status, shared_note = input.shared_note
      where trip_id = p_trip and id = p_id and content_version = p_version and kind = input.kind;
    if not found then return 'changed'; end if;
  end if;

  if input.kind = 'FLIGHT' then
    if detail is null or jsonb_array_length(detail) not between 1 and 20 then
      raise exception 'A flight booking requires 1 to 20 segments' using errcode = '23514';
    end if;
    delete from public.flight_segments where trip_id = p_trip and booking_id = p_id;
    insert into public.flight_segments (trip_id, booking_id, segment_order, airline_name, flight_number,
      departure_airport, arrival_airport, departure_local_date, arrival_local_date, departure_local_time, arrival_local_time,
      departure_timezone, arrival_timezone)
      select p_trip, p_id, entry.ordinal::integer, d.airline_name, d.flight_number,
        d.departure_airport, d.arrival_airport, d.departure_local_date, d.arrival_local_date,
        d.departure_local_time, d.arrival_local_time, d.departure_timezone, d.arrival_timezone
      from jsonb_array_elements(detail) with ordinality as entry(value, ordinal)
      cross join lateral jsonb_populate_record(null::public.flight_segments, entry.value) d;
  elsif input.kind = 'STAY' then
    delete from public.stay_details where trip_id = p_trip and booking_id = p_id;
    insert into public.stay_details (trip_id, booking_id, property_name, address_text, check_in_local_date, check_out_local_date,
      check_in_local_time, check_out_local_time, guest_count, room_count)
      select p_trip, p_id, input.title, d.address_text, d.check_in_local_date, d.check_out_local_date,
        d.check_in_local_time, d.check_out_local_time, d.guest_count, d.room_count
      from jsonb_populate_record(null::public.stay_details, detail) d;
  else
    delete from public.tour_details where trip_id = p_trip and booking_id = p_id;
    insert into public.tour_details (trip_id, booking_id, event_local_date, event_local_time, meeting_local_time,
      meeting_place_name, meeting_address_text, meeting_latitude, meeting_longitude)
      select p_trip, p_id, d.event_local_date, d.event_local_time, d.meeting_local_time,
        d.meeting_place_name, d.meeting_address_text, d.meeting_latitude, d.meeting_longitude
      from jsonb_populate_record(null::public.tour_details, detail) d;
  end if;

  delete from public.booking_private_details where trip_id = p_trip and booking_id = p_id;
  if jsonb_typeof(p_fields->'private') = 'object' then
    insert into public.booking_private_details (trip_id, booking_id, confirmation_reference, amount, currency, private_note)
      select p_trip, p_id, d.confirmation_reference, d.amount, d.currency, d.private_note
      from jsonb_populate_record(null::public.booking_private_details, p_fields->'private') d;
  end if;
  return 'saved';
end;
$$;

create function public.delete_booking(p_trip uuid, p_id uuid, p_version integer, p_expected uuid[])
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.trips where id = p_trip for no key update;
  if not found then return 'changed'; end if;
  if array(select id from public.itinerary_items where trip_id = p_trip and booking_id = p_id order by id)
     is distinct from array(select id from unnest(p_expected) as expected(id) order by id) then return 'preview'; end if;
  delete from public.bookings where trip_id = p_trip and id = p_id and content_version = p_version;
  if found then return 'deleted'; end if;
  return 'changed';
end;
$$;
revoke execute on function public.save_booking(uuid, uuid, integer, jsonb),
  public.delete_booking(uuid, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.save_booking(uuid, uuid, integer, jsonb),
  public.delete_booking(uuid, uuid, integer, uuid[]) to authenticated;

create or replace function public.save_itinerary_item(
  p_trip uuid, p_item uuid, p_revision integer, p_trip_version integer, p_fields jsonb
) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  input public.itinerary_items := jsonb_populate_record(null::public.itinerary_items, p_fields);
begin
  perform 1 from public.trips where id = p_trip and content_version = p_trip_version for no key update;
  if not found then return 'changed'; end if;
  if input.booking_id is not null and not exists (
    select 1 from public.bookings where trip_id = p_trip and id = input.booking_id
  ) then return 'invalid_booking'; end if;

  if p_revision is null then
    insert into public.itinerary_items
      (id, trip_id, title, kind, local_date, time_mode, fixed_local_time, period, place_id, booking_id, private_note, shared_note)
    values
      (p_item, p_trip, input.title, input.kind, input.local_date, input.time_mode, input.fixed_local_time,
       input.period, input.place_id, input.booking_id, input.private_note, input.shared_note)
    on conflict (id) do nothing;
    if found then return 'saved'; end if;
    if exists (select 1 from public.itinerary_items where id = p_item and trip_id = p_trip) then return 'existing'; end if;
    return 'changed';
  end if;

  update public.itinerary_items i
    set title = input.title, kind = input.kind, local_date = input.local_date,
        time_mode = input.time_mode, fixed_local_time = input.fixed_local_time, period = input.period,
        place_id = input.place_id, private_note = input.private_note, shared_note = input.shared_note,
        booking_id = case when p_fields ? 'booking_id' then input.booking_id else i.booking_id end,
        sort_order = case when (i.local_date, i.time_mode, i.fixed_local_time, i.period)
           is distinct from (input.local_date, input.time_mode, input.fixed_local_time, input.period)
           then nextval('public.itinerary_items_sort_order_seq'::regclass) else i.sort_order end,
        archived_date = case when input.local_date is null then i.archived_date end,
        archived_time_mode = case when input.local_date is null then i.archived_time_mode end,
        archived_fixed_time = case when input.local_date is null then i.archived_fixed_time end,
        archived_period = case when input.local_date is null then i.archived_period end,
        archived_sort_order = case when input.local_date is null then i.archived_sort_order end
    where i.trip_id = p_trip and i.id = p_item and i.revision = p_revision
      and (input.local_date is not null or i.local_date is null);
  if found then return 'saved'; end if;
  return 'changed';
end;
$$;

commit;
