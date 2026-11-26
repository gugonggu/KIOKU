import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function verifyOptionalBudget({page,app,owner,must}) {
  const id=crypto.randomUUID();
  must(await owner.client.from("trips").insert({id,title:"가상 환율 미확정 경비",destination_label:"Tokyo",traveler_count:2}),"optional budget fixture");
  const path="/trips/"+id+"/budget";
  await page.goto(app+path);
  await expect(page.getByRole("heading",{name:"지출 추가"})).toBeVisible();
  const create=page.locator("#new-expense");
  async function add(amount,currency,category,payer) {
    await create.getByLabel("원래 결제액").fill(String(amount));
    await create.getByLabel(/^통화/).selectOption(currency);
    await create.getByLabel("카테고리").selectOption(category);
    await create.getByLabel("결제자").selectOption(String(payer));
    for(const name of ["동행 1","동행 2"]) await create.getByRole("checkbox",{name,exact:true}).check();
    await create.getByRole("button",{name:"지출 등록",exact:true}).click();
  }
  await add(500,"JPY","food",2);
  await expect(page.getByRole("status")).toContainText("환율 미확정 1건 · 500엔");
  await add(1000,"KRW","cafe",1);
  await expect(page.getByText("동행 2 → 동행 1 · 500원",{exact:true})).toBeVisible();
  await expect(page.getByText("일부 환산 · 미완결",{exact:true})).toBeVisible();
  await page.screenshot({path:"test-results/kq18-pending-mobile.png",fullPage:true});
  const pending=page.locator("details.suite-expense").filter({has:page.locator("summary").filter({hasText:"식비 · 환율 미확정"})});
  await pending.locator("summary").first().click();
  await pending.getByLabel("적용 환율 (1엔당 원)",{exact:true}).fill("9");
  await pending.getByRole("button",{name:"지출 수정 저장",exact:true}).click();
  await expect(page.getByText("전체 환산 완료",{exact:true})).toBeVisible();
  await expect(page.getByText("동행 1 → 동행 2 · 1,750원",{exact:true})).toBeVisible();
  const saved=must(await owner.client.from("trip_expenses").select("amount,rate,currency").eq("trip_id",id),"original expenses preserved");
  assert.deepEqual(saved.map(row=>[row.currency,row.amount,row.rate]).sort(),[["JPY",500,90000],["KRW",1000,10000]]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}
