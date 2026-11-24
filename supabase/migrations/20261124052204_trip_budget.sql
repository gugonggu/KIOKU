begin;

create table public.trip_budgets (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  budget_krw integer not null check (budget_krw between 0 and 1000000000),
  rate integer not null check (rate between 1 and 999999),
  people text[] not null check (array_ndims(people) = 1 and array_lower(people, 1) = 1 and cardinality(people) between 1 and 12)
);

create table public.trip_expenses (
  id uuid primary key,
  trip_id uuid not null references public.trip_budgets(trip_id) on delete cascade,
  title text not null check (char_length(title) <= 100 and title ~ '[^[:space:]]'),
  amount integer not null check (amount between 1 and 1000000000),
  refund integer not null default 0 check (refund between 0 and amount),
  currency text not null check (currency in ('KRW','JPY')),
  rate integer not null check (rate between 1 and 999999 and (currency <> 'KRW' or rate = 10000)),
  spent_on date not null check (spent_on between date '0001-01-01' and date '9999-12-31'),
  category text not null check (category in ('flight','stay','transit','food','cafe','sightseeing','shopping','tour','internet','insurance','other')),
  payer integer not null,
  shares integer[] not null check (array_ndims(shares) = 1 and array_lower(shares, 1) = 1 and cardinality(shares) between 1 and 12),
  method text check (char_length(method) <= 40),
  prepaid boolean not null,
  note text check (char_length(note) <= 500),
  booking_id uuid,
  revision integer not null default 1 check (revision >= 1),
  unique (trip_id, booking_id),
  foreign key (trip_id, booking_id) references public.bookings(trip_id, id) on delete set null (booking_id)
);

create index trip_expenses_by_day on public.trip_expenses (trip_id, spent_on desc, id);

alter table public.trip_budgets enable row level security;
alter table public.trip_expenses enable row level security;

create policy trip_budgets_owner on public.trip_budgets to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid())));
create policy trip_expenses_owner on public.trip_expenses to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = (select auth.uid())));

revoke all on public.trip_budgets, public.trip_expenses from public, anon, authenticated;
grant select, insert on public.trip_budgets, public.trip_expenses to authenticated;
grant update (budget_krw, rate, people) on public.trip_budgets to authenticated;
grant update (title, amount, refund, currency, rate, spent_on, category, payer, shares, method, prepaid, note, booking_id) on public.trip_expenses to authenticated;
grant delete on public.trip_expenses to authenticated;

create function kioku_private.validate_budget_people() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.people) alias where alias is null or char_length(alias) > 30 or alias !~ '[^[:space:]]')
      or cardinality(new.people) <> (select count(distinct lower(btrim(alias))) from unnest(new.people) alias) then
    raise check_violation using message = 'Invalid settlement aliases';
  end if;
  if tg_op = 'UPDATE' and cardinality(new.people) < cardinality(old.people) and exists (
    select 1 from public.trip_expenses e where e.trip_id = new.trip_id and
      (e.payer > cardinality(new.people) or exists (select 1 from unnest(e.shares) s where s > cardinality(new.people)))
  ) then
    raise check_violation using message = 'Settlement participant is in use';
  end if;
  return new;
end;
$$;

create function kioku_private.validate_expense_people() returns trigger
language plpgsql set search_path = '' as $$
declare person_count integer;
begin
  if tg_op = 'UPDATE' then new.revision := old.revision + 1; end if;
  if tg_op = 'UPDATE' and new.payer = old.payer and new.shares = old.shares then return new; end if;
  select cardinality(people) into person_count from public.trip_budgets where trip_id = new.trip_id for share;
  if person_count is null or new.payer not between 1 and person_count
      or exists (select 1 from unnest(new.shares) s where s is null or s not between 1 and person_count)
      or cardinality(new.shares) <> (select count(distinct s) from unnest(new.shares) s) then
    raise check_violation using message = 'Invalid settlement participants';
  end if;
  return new;
end;
$$;

revoke all on function kioku_private.validate_budget_people(), kioku_private.validate_expense_people() from public, anon, authenticated;

create trigger trip_budgets_validate_people before insert or update of people on public.trip_budgets
  for each row execute function kioku_private.validate_budget_people();
create trigger trip_expenses_validate_people before insert or update on public.trip_expenses
  for each row execute function kioku_private.validate_expense_people();

create function public.save_trip_budget(p_trip uuid, p_amount integer, p_rate integer, p_people text[]) returns void
language sql set search_path = '' as $$
  insert into public.trip_budgets(trip_id,budget_krw,rate,people) values (p_trip,p_amount,p_rate,p_people)
  on conflict (trip_id) do update set budget_krw=excluded.budget_krw,rate=excluded.rate,people=excluded.people;
$$;
revoke all on function public.save_trip_budget(uuid,integer,integer,text[]) from public, anon, authenticated;
grant execute on function public.save_trip_budget(uuid,integer,integer,text[]) to authenticated;

commit;
