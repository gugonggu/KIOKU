begin;

-- Expense payer/share positions refer to this array. Keep the existing prefix
-- while expenses exist so older clients cannot reassign their participants.
create or replace function kioku_private.validate_budget_people() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.people) alias where alias is null or char_length(alias) > 30 or alias !~ '[^[:space:]]')
      or cardinality(new.people) <> (select count(distinct lower(btrim(alias))) from unnest(new.people) alias) then
    raise check_violation using message = 'Invalid settlement aliases';
  end if;
  if tg_op = 'UPDATE' and new.people is distinct from old.people
      and (cardinality(new.people) < cardinality(old.people)
        or new.people[1:cardinality(old.people)] is distinct from old.people)
      and exists (select 1 from public.trip_expenses e where e.trip_id = old.trip_id) then
    raise check_violation using message = 'Existing settlement participants must keep their names and positions';
  end if;
  return new;
end;
$$;

commit;
