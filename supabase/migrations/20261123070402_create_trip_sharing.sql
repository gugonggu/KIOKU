begin;

create table kioku_private.trip_share_links (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  encrypted_token text check (char_length(encrypted_token) between 40 and 160),
  enabled boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  show_booking_schedule boolean not null default true,
  show_shared_notes boolean not null default false,
  revision integer not null default 1,
  check ((enabled and token_hash is not null and encrypted_token is not null and revoked_at is null) or
    (not enabled and token_hash is null and encrypted_token is null))
);
alter table kioku_private.trip_share_links enable row level security;
revoke all on kioku_private.trip_share_links from public, anon, authenticated;

create function kioku_private.owns_shared_trip(p_trip uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.trips t where t.id = p_trip and t.owner_id = auth.uid()
      and auth.jwt()->>'is_anonymous' is distinct from 'true'
  )
$$;

-- Every JSON object is an explicit projection, including nested place and booking data.
create function kioku_private.shared_trip_payload(p_trip uuid, p_bookings boolean, p_notes boolean)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'title', t.title, 'destination', t.destination_label, 'startDate', t.start_date, 'endDate', t.end_date,
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'date', i.local_date,
        'fixed_local_time', i.fixed_local_time, 'period', i.period,
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

create function kioku_private.read_shared_trip(p_proof text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select kioku_private.shared_trip_payload(l.trip_id, l.show_booking_schedule, l.show_shared_notes)
  from kioku_private.trip_share_links l
  where l.token_hash = case when p_proof ~ '^[0-9a-f]{64}$' then encode(sha256(decode(p_proof, 'hex')), 'hex') end
    and l.enabled and l.revoked_at is null and (l.expires_at is null or l.expires_at > statement_timestamp())
$$;

create function kioku_private.read_share_settings(p_trip uuid, p_preview boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  link kioku_private.trip_share_links;
begin
  if not kioku_private.owns_shared_trip(p_trip) then return null; end if;
  select * into link from kioku_private.trip_share_links where trip_id = p_trip;
  if p_preview then return kioku_private.shared_trip_payload(p_trip,
    coalesce(link.show_booking_schedule, true), coalesce(link.show_shared_notes, false)); end if;
  return jsonb_build_object('enabled', coalesce(link.enabled, false), 'encryptedToken', link.encrypted_token,
    'expired', coalesce(link.expires_at <= statement_timestamp(), false) and coalesce(link.enabled, false),
    'expiresOn', (link.expires_at at time zone 'Asia/Tokyo')::date - 1,
    'bookings', coalesce(link.show_booking_schedule, true), 'notes', coalesce(link.show_shared_notes, false),
    'revision', coalesce(link.revision, 0));
end;
$$;

create function kioku_private.write_share_settings(p_trip uuid, p_revision integer, p_mode text, p_expiry date,
  p_bookings boolean, p_notes boolean, p_hash text, p_cipher text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  link kioku_private.trip_share_links;
  next_expiry timestamptz := (p_expiry + 1)::timestamp at time zone 'Asia/Tokyo';
  stopped boolean;
begin
  if not kioku_private.owns_shared_trip(p_trip) then return false; end if;
  perform 1 from public.trips where id = p_trip and owner_id = auth.uid() for no key update;
  if not found then return false; end if;
  select * into link from kioku_private.trip_share_links where trip_id = p_trip;
  if p_revision is distinct from coalesce(link.revision, 0) then return false; end if;
  if p_mode is null or p_mode not in ('issue','settings','stop') then return false; end if;
  if p_mode = 'issue' and (p_hash is null or p_cipher is null or p_hash = link.token_hash) then return false; end if;
  if p_mode = 'stop' and not coalesce(link.enabled, false) then return false; end if;
  stopped := p_mode = 'stop' or (p_mode = 'settings' and (
    not coalesce(link.enabled, false) or coalesce(link.expires_at <= statement_timestamp(), false)));
  insert into kioku_private.trip_share_links (trip_id, token_hash, encrypted_token, enabled, expires_at, revoked_at,
    show_booking_schedule, show_shared_notes, revision)
  values (p_trip,
    case when p_mode = 'issue' then p_hash when not stopped then link.token_hash end,
    case when p_mode = 'issue' then p_cipher when not stopped then link.encrypted_token end,
    not stopped, case when p_mode = 'stop' then link.expires_at else next_expiry end,
    case when stopped and link.enabled then statement_timestamp() when stopped then link.revoked_at end,
    case when p_mode = 'stop' then link.show_booking_schedule else p_bookings end,
    case when p_mode = 'stop' then link.show_shared_notes else p_notes end, p_revision + 1)
  on conflict (trip_id) do update set token_hash = excluded.token_hash, encrypted_token = excluded.encrypted_token,
    enabled = excluded.enabled, expires_at = excluded.expires_at, revoked_at = excluded.revoked_at,
    show_booking_schedule = excluded.show_booking_schedule, show_shared_notes = excluded.show_shared_notes,
    revision = excluded.revision;
  return true;
end;
$$;

-- Expose only invoker wrappers to PostgREST. The privileged functions live in the unexposed schema.
create function public.read_shared_trip(p_proof text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select kioku_private.read_shared_trip(p_proof)
$$;
create function public.read_share_settings(p_trip uuid, p_preview boolean) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select kioku_private.read_share_settings(p_trip, p_preview)
$$;
create function public.write_share_settings(p_trip uuid, p_revision integer, p_mode text, p_expiry date,
  p_bookings boolean, p_notes boolean, p_hash text, p_cipher text) returns boolean
language sql security invoker set search_path = '' as $$
  select kioku_private.write_share_settings(p_trip,p_revision,p_mode,p_expiry,p_bookings,p_notes,p_hash,p_cipher)
$$;

revoke execute on function kioku_private.owns_shared_trip(uuid), kioku_private.shared_trip_payload(uuid,boolean,boolean),
  kioku_private.read_shared_trip(text), kioku_private.read_share_settings(uuid,boolean),
  kioku_private.write_share_settings(uuid,integer,text,date,boolean,boolean,text,text),
  public.read_shared_trip(text), public.read_share_settings(uuid,boolean),
  public.write_share_settings(uuid,integer,text,date,boolean,boolean,text,text)
  from public, anon, authenticated;
grant usage on schema kioku_private to anon, authenticated;
grant execute on function kioku_private.read_shared_trip(text), public.read_shared_trip(text) to anon, authenticated;
grant execute on function kioku_private.read_share_settings(uuid,boolean), public.read_share_settings(uuid,boolean),
  kioku_private.write_share_settings(uuid,integer,text,date,boolean,boolean,text,text),
  public.write_share_settings(uuid,integer,text,date,boolean,boolean,text,text) to authenticated;

commit;
