begin;
alter table public.trips add column cover_theme text not null default 'auto'
  check (cover_theme in ('auto','mountain','sea','dusk','winter'));
grant update(cover_theme) on public.trips to authenticated;

create function public.set_trip_cover(p_trip uuid,p_version integer,p_theme text,p_photo uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_theme is null or p_theme not in ('auto','mountain','sea','dusk','winter') then raise invalid_parameter_value; end if;
  perform 1 from public.trips where id=p_trip and owner_id=auth.uid() and content_version=p_version for no key update;
  if not found then return false; end if;
  if p_photo is not null then
    perform 1 from public.trip_memory_photos where trip_id=p_trip and id=p_photo and phase='ready' for update;
    if not found then return false; end if;
  end if;
  update public.trip_memory_photos set is_cover=false where trip_id=p_trip and is_cover;
  if p_photo is not null then
    update public.trip_memory_photos set is_cover=true where trip_id=p_trip and id=p_photo and phase='ready';
    if not found then raise serialization_failure; end if;
  end if;
  update public.trips set cover_theme=p_theme where id=p_trip;
  return true;
end $$;
revoke all on function public.set_trip_cover(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.set_trip_cover(uuid,integer,text,uuid) to authenticated;
commit;
