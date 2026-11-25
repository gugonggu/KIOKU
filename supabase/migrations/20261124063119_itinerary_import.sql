begin;

create function public.import_trip_schedule(p_trip uuid, p_version integer, p_rows jsonb)
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
      'title','local_date','time_mode','fixed_local_time','period'
    )) then raise invalid_parameter_value; end if;
    select * into fields from jsonb_to_record(row_data) as i(
      title text, local_date text, time_mode text, fixed_local_time text, period text);
    if jsonb_typeof(row_data->'title') is distinct from 'string'
      or char_length(btrim(fields.title)) not between 1 and 100
      or fields.time_mode is null or fields.time_mode not in ('FIXED','PERIOD','UNSCHEDULED')
      or (fields.local_date is not null and fields.local_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      or (fields.fixed_local_time is not null and fields.fixed_local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
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
      insert into public.itinerary_items(trip_id,title,kind,local_date,time_mode,fixed_local_time,period)
      values (p_trip,btrim(fields.title),'NOTE',day,fields.time_mode,clock,fields.period);
      inserted := inserted + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted',inserted,'skipped',skipped);
end;
$$;
revoke all on function public.import_trip_schedule(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.import_trip_schedule(uuid,integer,jsonb) to authenticated;

commit;
