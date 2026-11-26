-- Run only against the disposable local Supabase stack. All fixtures roll back.
begin;
insert into auth.users(id) values ('a9111111-1111-4111-8111-111111111111');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9111111-1111-4111-8111-111111111111","is_anonymous":false}',true);
insert into public.trips(id,title,destination_label) values ('a9222222-2222-4222-8222-222222222222','End time fixture','Tokyo');
do $$
declare t uuid := 'a9222222-2222-4222-8222-222222222222';
declare i uuid := 'a9333333-3333-4333-8333-333333333333';
declare v integer;
declare r integer;
declare fields jsonb := '{"title":"Walk","kind":"NOTE","local_date":"2027-02-17","time_mode":"FIXED","fixed_local_time":"09:00","end_local_time":"10:30","period":null}';
begin
  select content_version into v from public.trips where id=t;
  assert public.save_itinerary_item(t,i,null,v,fields) = 'saved';
  assert (select end_local_time = time '10:30' from public.itinerary_items where id=i);
  select content_version into v from public.trips where id=t;
  select revision into r from public.itinerary_items where id=i;
  assert public.save_itinerary_item(t,i,r,v,fields - 'end_local_time') = 'saved';
  assert (select end_local_time = time '10:30' from public.itinerary_items where id=i);
  select content_version into v from public.trips where id=t;
  select revision into r from public.itinerary_items where id=i;
  assert public.place_itinerary_item(t,i,r,'archive',null,v);
  assert (select end_local_time is null from public.itinerary_items where id=i);
  select content_version into v from public.trips where id=t;
  select revision into r from public.itinerary_items where id=i;
  assert public.place_itinerary_item(t,i,r,'restore',null,v);
  assert (select end_local_time = time '10:30' from public.itinerary_items where id=i);
end $$;
reset role;
do $$ begin
  assert not has_column_privilege('anon','public.itinerary_items','end_local_time','select');
  assert (select kioku_private.shared_trip_payload('a9222222-2222-4222-8222-222222222222',true,true)->'schedule'->0->>'end_local_time' = '10:30:00');
end $$;
rollback;
