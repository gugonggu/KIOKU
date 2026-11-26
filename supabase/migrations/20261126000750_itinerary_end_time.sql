begin;
alter table public.itinerary_items
  add column end_local_time time(0),
  add column archived_end_time time(0),
  add constraint itinerary_end_time_valid check (end_local_time is null or
    (time_mode = 'FIXED' and fixed_local_time is not null and end_local_time > fixed_local_time
     and end_local_time < time '24:00' and extract(second from end_local_time) = 0)),
  add constraint itinerary_archived_end_valid check (archived_end_time is null or
    (archived_time_mode = 'FIXED' and archived_fixed_time is not null and archived_end_time > archived_fixed_time
     and archived_end_time < time '24:00' and extract(second from archived_end_time) = 0));
grant insert(end_local_time), update(end_local_time,archived_end_time) on public.itinerary_items to authenticated;
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
      (id, trip_id, title, kind, local_date, time_mode, fixed_local_time, end_local_time, period, place_id, booking_id, private_note, shared_note)
    values
      (p_item, p_trip, input.title, input.kind, input.local_date, input.time_mode, input.fixed_local_time,
       input.end_local_time, input.period, input.place_id, input.booking_id, input.private_note, input.shared_note)
    on conflict (id) do nothing;
    if found then return 'saved'; end if;
    if exists (select 1 from public.itinerary_items where id = p_item and trip_id = p_trip) then return 'existing'; end if;
    return 'changed';
  end if;

  update public.itinerary_items i
    set title = input.title, kind = input.kind, local_date = input.local_date,
        time_mode = input.time_mode, fixed_local_time = input.fixed_local_time, period = input.period,
        end_local_time = case when p_fields ? 'end_local_time' then input.end_local_time
          when input.time_mode = 'FIXED' and i.end_local_time > input.fixed_local_time then i.end_local_time end,
        place_id = input.place_id, private_note = input.private_note, shared_note = input.shared_note,
        booking_id = case when p_fields ? 'booking_id' then input.booking_id else i.booking_id end,
        sort_order = case when (i.local_date, i.time_mode, i.fixed_local_time, i.period)
           is distinct from (input.local_date, input.time_mode, input.fixed_local_time, input.period)
           then nextval('public.itinerary_items_sort_order_seq'::regclass) else i.sort_order end,
        archived_date = case when input.local_date is null then i.archived_date end,
        archived_time_mode = case when input.local_date is null then i.archived_time_mode end,
        archived_fixed_time = case when input.local_date is null then i.archived_fixed_time end,
        archived_end_time = case when input.local_date is null then i.archived_end_time end,
        archived_period = case when input.local_date is null then i.archived_period end,
        archived_sort_order = case when input.local_date is null then i.archived_sort_order end
    where i.trip_id = p_trip and i.id = p_item and i.revision = p_revision
      and (input.local_date is not null or i.local_date is null);
  if found then return 'saved'; end if;
  return 'changed';
end;
$$;


create or replace function public.place_itinerary_item(
  p_trip uuid, p_item uuid, p_revision integer, p_command text, p_date date, p_trip_version integer
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  item public.itinerary_items;
  restore_order bigint;
begin
  perform 1 from public.trips where id = p_trip and content_version = p_trip_version for no key update;
  if not found then return false; end if;
  select * into item from public.itinerary_items where trip_id = p_trip and id = p_item and revision = p_revision for update;
  if not found then return false; end if;

  if p_command = 'archive' and item.local_date is not null then
    update public.itinerary_items set archived_date = local_date, archived_time_mode = time_mode,
      archived_fixed_time = fixed_local_time, archived_end_time = end_local_time, archived_period = period, archived_sort_order = sort_order,
      local_date = null, time_mode = 'UNSCHEDULED', fixed_local_time = null, end_local_time = null, period = null, sort_order = default
      where id = p_item and trip_id = p_trip;
  elsif p_command = 'restore' and item.archived_date is not null then
    restore_order := item.archived_sort_order;
    -- Preserve intervening edits: if the old position is occupied, append within the target group.
    if exists (
      select 1 from public.itinerary_items i where i.trip_id = p_trip and i.sort_order = restore_order
        and (i.local_date, i.time_mode, i.fixed_local_time, i.period) is not distinct from
            (item.archived_date, item.archived_time_mode, item.archived_fixed_time, item.archived_period)
    ) then
      restore_order := nextval('public.itinerary_items_sort_order_seq'::regclass);
    end if;
    update public.itinerary_items set local_date = archived_date, time_mode = archived_time_mode,
      fixed_local_time = archived_fixed_time, end_local_time = archived_end_time, period = archived_period, sort_order = restore_order,
      archived_date = null, archived_time_mode = null, archived_fixed_time = null, archived_end_time = null, archived_period = null, archived_sort_order = null
      where id = p_item and trip_id = p_trip;
  elsif p_command = 'move' and p_date is not null and p_date is distinct from item.local_date then
    update public.itinerary_items set local_date = p_date, sort_order = default,
      archived_date = null, archived_time_mode = null, archived_fixed_time = null, archived_end_time = null, archived_period = null, archived_sort_order = null
      where id = p_item and trip_id = p_trip;
  elsif p_command = 'delete' then
    delete from public.itinerary_items where id = p_item and trip_id = p_trip;
  else
    return false;
  end if;
  return true;
end;
$$;




create or replace function public.import_trip_schedule(p_trip uuid, p_version integer, p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare trip public.trips;
declare row_data jsonb;
declare fields record;
declare day date;
declare clock time;
declare inserted integer := 0;
declare skipped integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_rows) not between 1 and 30 or char_length(p_rows::text) > 24000 then raise invalid_parameter_value; end if;
  select * into trip from public.trips
    where id=p_trip and owner_id=auth.uid() and content_version=p_version for no key update;
  if not found then return null; end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row_data) is distinct from 'object' then raise invalid_parameter_value; end if;
    if exists(select 1 from jsonb_object_keys(row_data) k where k not in (
      'title','local_date','time_mode','fixed_local_time','end_local_time','period'
    )) then raise invalid_parameter_value; end if;
    select * into fields from jsonb_to_record(row_data) as i(
      title text, local_date text, time_mode text, fixed_local_time text, end_local_time text, period text);
    if jsonb_typeof(row_data->'title') is distinct from 'string'
      or char_length(btrim(fields.title)) not between 1 and 100
      or fields.time_mode is null or fields.time_mode not in ('FIXED','PERIOD','UNSCHEDULED')
      or (fields.local_date is not null and fields.local_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (fields.fixed_local_time is not null and fields.fixed_local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      or (fields.end_local_time is not null and (fields.time_mode <> 'FIXED'
        or fields.end_local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or fields.end_local_time <= fields.fixed_local_time))
      or (fields.time_mode='FIXED' and (fields.fixed_local_time is null or fields.local_date is null or fields.period is not null))
      or (fields.time_mode='PERIOD' and (fields.period is null or fields.period not in ('MORNING','AFTERNOON','EVENING')
        or fields.local_date is null or fields.fixed_local_time is not null))
      or (fields.time_mode='UNSCHEDULED' and (fields.fixed_local_time is not null or fields.period is not null)) then
      raise invalid_parameter_value;
    end if;
    day := fields.local_date::date;
    clock := fields.fixed_local_time::time;
    if day is not null and trip.start_date is not null and (day<trip.start_date or day>trip.end_date) then
      raise invalid_parameter_value using message='Schedule date outside trip';
    end if;
    if exists (select 1 from public.itinerary_items i where i.trip_id=p_trip
      and lower(btrim(i.title))=lower(btrim(fields.title))
      and i.local_date is not distinct from day and i.time_mode=fields.time_mode
      and i.fixed_local_time is not distinct from clock and i.period is not distinct from fields.period) then
      skipped := skipped + 1;
    else
      insert into public.itinerary_items(trip_id,title,kind,local_date,time_mode,fixed_local_time,end_local_time,period)
      values (p_trip,btrim(fields.title),'NOTE',day,fields.time_mode,clock,fields.end_local_time::time,fields.period);
      inserted := inserted + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'skipped',skipped);
end;
$$;
revoke all on function public.import_trip_schedule(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.import_trip_schedule(uuid,integer,jsonb) to authenticated;


create or replace function kioku_private.shared_trip_payload(p_trip uuid, p_bookings boolean, p_notes boolean)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'title', t.title, 'destination', t.destination_label, 'startDate', t.start_date, 'endDate', t.end_date,
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'date', i.local_date,
        'fixed_local_time', i.fixed_local_time, 'end_local_time', i.end_local_time, 'period', i.period,
        'place', case when p.id is not null then jsonb_build_object('name', p.display_name, 'address', coalesce(p.address_ja,p.address_text),
          'latitude', p.latitude, 'longitude', p.longitude) end)
        || case when p_notes then jsonb_build_object('note', i.shared_note) else '{}'::jsonb end
        order by i.local_date, case i.time_mode when 'FIXED' then 0 when 'PERIOD' then 1 else 2 end,
          i.fixed_local_time, case i.period when 'MORNING' then 0 when 'AFTERNOON' then 1 when 'EVENING' then 2 end,
          i.sort_order, i.id)
      from public.itinerary_items i
      left join public.trip_places p on p.trip_id = i.trip_id and p.id = i.place_id
      where i.trip_id = t.id and i.local_date is not null
    ), '[]'::jsonb),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.display_name, 'address', coalesce(p.address_ja,p.address_text),
        'latitude', p.latitude, 'longitude', p.longitude) order by p.display_name, p.id)
      from public.trip_places p where p.trip_id = t.id
    ), '[]'::jsonb),
    'bookings', case when p_bookings then coalesce((
      select jsonb_agg(jsonb_build_object('kind', b.kind, 'title', b.title, 'status', b.status, 'detail',
        case b.kind
          when 'FLIGHT' then coalesce((select jsonb_agg(jsonb_build_object(
            'departureAirport', f.departure_airport, 'arrivalAirport', f.arrival_airport,
            'departureDate', f.departure_local_date, 'arrivalDate', f.arrival_local_date,
            'departureTime', f.departure_local_time, 'arrivalTime', f.arrival_local_time,
            'departureZone', f.departure_timezone, 'arrivalZone', f.arrival_timezone) order by f.segment_order)
            from public.flight_segments f where f.trip_id = b.trip_id and f.booking_id = b.id), '[]'::jsonb)
          when 'STAY' then (select jsonb_build_object('address', s.address_text,
            'checkInDate', s.check_in_local_date, 'checkInTime', s.check_in_local_time,
            'checkOutDate', s.check_out_local_date, 'checkOutTime', s.check_out_local_time)
            from public.stay_details s where s.trip_id = b.trip_id and s.booking_id = b.id)
          when 'TOUR' then (select jsonb_build_object('date', r.event_local_date, 'time', r.event_local_time,
            'meetingTime', r.meeting_local_time, 'meetingName', r.meeting_place_name, 'meetingAddress', r.meeting_address_text,
            'latitude', r.meeting_latitude, 'longitude', r.meeting_longitude)
            from public.tour_details r where r.trip_id = b.trip_id and r.booking_id = b.id)
        end)
        || case when p_notes then jsonb_build_object('note', b.shared_note) else '{}'::jsonb end
        order by b.kind, b.title, b.id)
      from public.bookings b where b.trip_id = t.id
    ), '[]'::jsonb) end
  )
  from public.trips t where t.id = p_trip
$$;

commit;
