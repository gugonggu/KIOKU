import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asUser, createTripsDatabase, ownerA, ownerB } from "./support/trips-db.mjs";
const legacyTrip=randomUUID(), legacyExpense=randomUUID();
const db=await createTripsDatabase({beforeMigration:async(database,file)=>{
  if(file!=="20261125090002_preserve_settlement_participants.sql") return;
  await asUser(database,ownerA,async tx=>{
    await tx.query("insert into public.trips(id,title,destination_label) values ($1,'Legacy','Tokyo')",[legacyTrip]);
    await tx.query("select public.save_trip_budget($1,500000,90000,array['A','B'])",[legacyTrip]);
    await tx.query("insert into public.trip_expenses(id,trip_id,title,amount,refund,currency,rate,spent_on,category,payer,shares,prepaid) values ($1,$2,'Legacy',105,5,'JPY',90000,'2027-02-17','food',1,array[1,2],false)",[legacyExpense,legacyTrip]);
  });
}});
test.after(()=>db.close());
test("incremental migrations preserve v1.0 amounts, refunds, rates and participant indexes",async()=>{
  const {rows}=await asUser(db,ownerA,tx=>tx.query("select amount,refund,e.rate,revision,payer,shares,people from public.trip_expenses e join public.trip_budgets b using(trip_id) where e.id=$1",[legacyExpense]));
  assert.deepEqual(rows,[{amount:105,refund:5,rate:90000,revision:1,payer:1,shares:[1,2],people:["A","B"]}]);
});
test("first expense initializes only the owner's participant ledger without a budget or FX rate",async()=>{
  const trip=randomUUID(), expense=randomUUID();
  await asUser(db,ownerA,tx=>tx.query("insert into public.trips(id,title,destination_label,traveler_count) values ($1,'Fixture','Tokyo',2)",[trip]));
  const insert=user=>asUser(db,user,tx=>tx.query("insert into public.trip_expenses(id,trip_id,title,amount,currency,rate,spent_on,category,payer,shares,prepaid) values ($1,$2,'Walk',500,'JPY',null,'2027-02-17','food',1,array[1,2],false)",[expense,trip]));
  await assert.rejects(insert(ownerB));
  await insert(ownerA);
  const ledger=await asUser(db,ownerA,tx=>tx.query("select budget_krw,rate,people from public.trip_budgets where trip_id=$1",[trip]));
  assert.deepEqual(ledger.rows[0],{budget_krw:0,rate:null,people:["동행 1","동행 2"]});
  await asUser(db,ownerA,tx=>tx.query("update public.trip_expenses set rate=90000 where id=$1",[expense]));
  await assert.rejects(asUser(db,ownerA,tx=>tx.query("update public.trip_expenses set currency='KRW',rate=null where id=$1",[expense])),{code:"23514"});
  await assert.rejects(asUser(db,ownerA,tx=>tx.query("update public.trip_budgets set people=array['동행 2','동행 1'] where trip_id=$1",[trip])),{code:"23514"});
  const row=await asUser(db,ownerA,tx=>tx.query("select amount,rate,revision,payer,shares from public.trip_expenses where id=$1",[expense]));
  assert.deepEqual(row.rows[0],{amount:500,rate:90000,revision:2,payer:1,shares:[1,2]});
});
