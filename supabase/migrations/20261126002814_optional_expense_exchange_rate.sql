begin;
alter table public.trip_budgets alter column rate drop not null;
alter table public.trip_expenses alter column rate drop not null;
alter table public.trip_expenses drop constraint trip_expenses_check1;
alter table public.trip_expenses add constraint trip_expenses_rate_check check (
  (currency='KRW' and rate is not null and rate=10000)
  or (currency='JPY' and (rate is null or rate between 1 and 999999))
);

-- Keep the existing integer participant IDs and protection trigger. A first
-- expense creates an optional, zero-budget ledger atomically under owner RLS.
create or replace function kioku_private.validate_expense_people() returns trigger
language plpgsql security invoker set search_path='' as $$
declare person_count integer;
begin
  if tg_op='INSERT' then
    insert into public.trip_budgets(trip_id,budget_krw,rate,people)
      select t.id,0,null,case when coalesce(t.traveler_count,1)=1 then array['나']
        else array(select '동행 ' || n from generate_series(1,least(coalesce(t.traveler_count,1),12)) n) end
      from public.trips t where t.id=new.trip_id and t.owner_id=auth.uid()
      on conflict(trip_id) do nothing;
  end if;
  if tg_op='UPDATE' then new.revision := old.revision+1; end if;
  if tg_op='UPDATE' and new.payer=old.payer and new.shares=old.shares then return new; end if;
  select cardinality(people) into person_count from public.trip_budgets where trip_id=new.trip_id for share;
  if person_count is null or new.payer not between 1 and person_count
    or exists(select 1 from unnest(new.shares) s where s is null or s not between 1 and person_count)
    or cardinality(new.shares) <> (select count(distinct s) from unnest(new.shares) s) then
    raise check_violation using message='Invalid settlement participants';
  end if;
  return new;
end $$;
commit;
