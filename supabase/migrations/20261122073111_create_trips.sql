begin;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 80 and title ~ '[^[:space:]]'),
  destination_label text not null check (char_length(destination_label) <= 80 and destination_label ~ '[^[:space:]]'),
  country_code text not null default 'JP' check (country_code = 'JP'),
  timezone text not null default 'Asia/Tokyo' check (timezone = 'Asia/Tokyo'),
  start_date date,
  end_date date,
  traveler_count integer check (traveler_count >= 1),
  cover_photo_id uuid,
  content_version integer not null default 1 check (content_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_pair check (
    (start_date is null and end_date is null)
    or (
      start_date is not null and end_date is not null
      and start_date >= date '0001-01-01' and end_date <= date '9999-12-31'
      and start_date <= end_date
    )
  ),
  constraint trips_default_cover check (cover_photo_id is null)
);

create index trips_owner_created_idx on public.trips (owner_id, created_at desc, id);

create function public.set_trip_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.content_version := old.content_version + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger trips_set_revision
before update on public.trips
for each row execute function public.set_trip_revision();

revoke execute on function public.set_trip_revision() from public, anon, authenticated;
revoke all on table public.trips from public, anon, authenticated;
grant select, delete on table public.trips to authenticated;
grant insert (id, title, destination_label, start_date, end_date, traveler_count)
  on table public.trips to authenticated;
grant update (title, destination_label, start_date, end_date, traveler_count)
  on table public.trips to authenticated;

alter table public.trips enable row level security;

create policy trips_signed_in on public.trips as restrictive
  for all to authenticated
  using ((select auth.jwt()->>'is_anonymous') is distinct from 'true')
  with check ((select auth.jwt()->>'is_anonymous') is distinct from 'true');

create policy trips_select_own on public.trips
  for select to authenticated using (owner_id = (select auth.uid()));

create policy trips_insert_own on public.trips
  for insert to authenticated with check (owner_id = (select auth.uid()));

create policy trips_update_own on public.trips
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy trips_delete_own on public.trips
  for delete to authenticated using (owner_id = (select auth.uid()));

commit;
