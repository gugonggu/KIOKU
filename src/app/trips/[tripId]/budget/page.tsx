import { randomUUID } from "node:crypto";
import Link from "next/link";
import { loadBookingSummaries, type BookingSummary } from "@/lib/trip-booking-data";
import { bookingStatuses } from "@/lib/trip-bookings";
import { expenseCategories, expenseTotals, expenseWon, settleExpenses, wonLabel, type Budget, type Expense } from "@/lib/trip-budget";
import { loadBudget } from "@/lib/trip-budget-data";
import { japanDate } from "@/lib/trip-details";
import { getTrip } from "@/lib/trips";
import { TripLoadError } from "../../trip-load-error";
import { TripTabs } from "../editorial";
import { removeExpense, saveBudget, saveExpense } from "./actions";
import { BudgetForm } from "./budget-form";

const categoryOptions = Object.entries(expenseCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>);

function ExpenseForm({ tripId, budget, bookings, usedBookings, expense }: {
  tripId: string; budget: Budget; bookings: BookingSummary[]; usedBookings: Set<string>; expense?: Expense;
}) {
  return <BudgetForm action={saveExpense.bind(null, tripId, expense?.id ?? randomUUID(), expense?.revision ?? null)}
    label={expense ? "지출 수정 저장" : "지출 등록"}>
    <label>지출명<input required name="title" maxLength={100} defaultValue={expense?.title} /></label>
    <div className="budget-grid">
      <label>원래 결제액<input name="amount" type="number" min="1" max="1000000000" step="1" defaultValue={expense?.amount} /></label>
      <label>통화<select name="currency" defaultValue={expense?.currency ?? "JPY"}><option>KRW</option><option>JPY</option></select></label>
      <label>적용 환율 (1엔당 원)<input name="rate" inputMode="decimal" defaultValue={(expense?.currency === "JPY" ? expense.rate : budget.rate) / 10000} /></label>
      <label>누적 환불액 (같은 통화)<input name="refund" type="number" min="0" max="1000000000" step="1" defaultValue={expense?.refund ?? 0} /></label>
      <label>지출 날짜<input required type="date" name="date" defaultValue={expense?.spent_on ?? japanDate()} /></label>
      <label>카테고리<select name="category" defaultValue={expense?.category ?? "other"}>{categoryOptions}</select></label>
      <label>결제자<select name="payer" defaultValue={expense?.payer ?? 1}>{budget.people.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}</select></label>
      <label>결제 시점<select name="phase" defaultValue={expense?.prepaid ? "prepaid" : "local"}><option value="local">현지 결제</option><option value="prepaid">사전 결제</option></select></label>
    </div>
    <fieldset className="budget-shares"><legend>균등 분담 대상</legend>{budget.people.map((name, i) =>
      <label key={i}><input type="checkbox" name="shares" value={i + 1} defaultChecked={!expense || expense.shares.includes(i + 1)} />{name}</label>)}</fieldset>
    <label>결제수단<input name="method" maxLength={40} defaultValue={expense?.method ?? ""} placeholder="예: 현금" /></label>
    <label>연결 예약<select name="booking" defaultValue={expense?.booking_id ?? ""}>
      <option value="">선택 안 함</option>{bookings.filter((booking) => !usedBookings.has(booking.id) || booking.id === expense?.booking_id)
        .map((booking) => <option key={booking.id} value={booking.id}>{booking.title} · {bookingStatuses[booking.status]}</option>)}
    </select></label>
    <label className="budget-check"><input name="copyBooking" type="checkbox" />선택한 예약의 금액과 통화로 기록</label>
    <p className="plan-meta">실제 결제를 기록할 때만 선택하세요. 부분 결제는 누적 결제액으로 수정하고, 전액 환불은 원래 결제액과 같은 환불액을 입력하세요.</p>
    <label>메모<textarea name="note" maxLength={500} defaultValue={expense?.note ?? ""} /></label>
  </BudgetForm>;
}

export default async function Page({ params, searchParams }: PageProps<"/trips/[tripId]/budget">) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const { data: trip, error } = await getTrip(tripId);
  if (!trip || error) return <TripLoadError />;
  const [result, bookings] = await Promise.all([loadBudget(tripId), loadBookingSummaries(tripId)]);
  const href = "/trips/" + tripId;
  const budget = result?.budget;
  const expenses = result?.expenses ?? [];
  const totals = expenseTotals(expenses);
  const settlement = budget && settleExpenses(budget.people.length, expenses);
  const usedBookings = new Set(expenses.flatMap(({ booking_id }) => booking_id ? [booking_id] : []));
  const payer = typeof query.payer === "string" ? query.payer : "";
  const date = typeof query.date === "string" ? query.date : "";
  const category = typeof query.category === "string" ? query.category : "";
  const shown = expenses.filter((expense) => (!date || expense.spent_on === date) &&
    (!category || expense.category === category) && (!payer || String(expense.payer) === payer));
  const remaining = BigInt(budget?.budget_krw ?? 0) - totals.total;

  return <div className="editorial-page suite-page">
    <header><Link className="quiet-link" href={href + "/more"}>더보기</Link><h1>예산과 경비</h1><p>{trip.title} · 소유자만 볼 수 있어요.</p></header>
    {!result ? <p role="alert" className="notice notice-error">예산과 경비를 불러오지 못했어요.</p> : <>
      {budget && <section className="editorial-paper suite-stack" aria-labelledby="budget-summary">
        <h2 id="budget-summary">예산 현황</h2>
        <dl className="budget-grid budget-totals">
          <div><dt>총예산</dt><dd>{wonLabel(budget.budget_krw)}</dd></div>
          <div><dt>총지출 (원화 환산)</dt><dd>{wonLabel(totals.total)}</dd></div>
          <div><dt>남은 예산</dt><dd>{wonLabel(remaining)}</dd></div>
          <div><dt>예산 사용률</dt><dd>{budget.budget_krw ? (totals.total * BigInt(100) / BigInt(budget.budget_krw)).toString() + "%" : "—"}</dd></div>
          <div><dt>사전 결제</dt><dd>{wonLabel(totals.prepaid)}</dd></div>
          <div><dt>현지 지출</dt><dd>{wonLabel(totals.local)}</dd></div>
        </dl>
        <p>통화별 순지출 {wonLabel(totals.krw)} · {totals.jpy.toLocaleString("ko-KR")}엔</p>
        {remaining < BigInt(0) && <p className="notice notice-error" role="status">설정한 예산을 초과했어요.</p>}
        {!!totals.categories.size && <ul>{[...totals.categories].map(([key, value]) => <li key={key}>
          {expenseCategories[key]} · {wonLabel(value)}{totals.total > BigInt(0) && " · " + (value * BigInt(100) / totals.total).toString() + "%"}
        </li>)}</ul>}
      </section>}
      <details open={!budget} className="editorial-paper suite-stack">
        <summary className="quiet-link">{budget ? "예산과 정산 인원 편집" : "예산과 정산 인원 설정"}</summary>
        <BudgetForm action={saveBudget.bind(null, tripId)} label="예산 저장">
          <label>총예산 (원)<input type="number" name="budget" required min="0" max="1000000000" step="1" defaultValue={budget?.budget_krw} /></label>
          <label>기본 환율 (1엔당 원)<input name="rate" required inputMode="decimal" placeholder="예: 9.1234" defaultValue={budget ? budget.rate / 10000 : undefined} /></label>
          <label>정산 별칭 (한 줄에 한 명)<textarea name="people" required rows={4} maxLength={400}
            defaultValue={budget?.people.join("\n") ?? Array.from({ length: Math.min(12, trip.traveler_count ?? 1) }, (_, i) => "동행 " + (i + 1)).join("\n")} /></label>
          <p className="plan-meta">지출마다 적용한 환율을 보관해요. 기존 인원의 별칭을 바꿀 때는 줄 순서를 유지하고 새 인원은 마지막 줄에 추가하세요.</p>
        </BudgetForm>
      </details>
      {budget && <>
        <section id="new-expense" className="editorial-paper suite-stack"><h2>지출 추가</h2>
          {bookings ? <ExpenseForm tripId={tripId} budget={budget} bookings={bookings} usedBookings={usedBookings} />
            : <p role="alert">연결할 예약 목록을 불러오지 못했어요.</p>}
        </section>
        <section className="editorial-paper suite-stack"><h2>지출 기록</h2>
          <form method="get" className="budget-grid" action={href + "/budget"}>
            <label>날짜로 찾기<input type="date" name="date" defaultValue={date} /></label>
            <label>카테고리로 찾기<select name="category" defaultValue={category}><option value="">전체</option>{categoryOptions}</select></label>
            <label>결제자로 찾기<select name="payer" defaultValue={payer}><option value="">전체</option>{budget.people.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}</select></label>
            <button type="submit" className="quiet-link">필터 적용</button>
          </form>
          {shown.length ? shown.map((expense) => <details key={expense.id} className="suite-expense">
            <summary className="quiet-link">{expense.title} · {wonLabel(expenseWon(expense))}{expense.refund === expense.amount ? " · 전액 환불" : ""}</summary>
            <p>{expense.spent_on} · {expenseCategories[expense.category]} · {budget.people[expense.payer - 1]}</p>
            <p>{expense.amount.toLocaleString("ko-KR")} {expense.currency}{expense.refund > 0 && " · 환불 " + expense.refund.toLocaleString("ko-KR")}</p>
            {bookings && <ExpenseForm tripId={tripId} budget={budget} bookings={bookings} usedBookings={usedBookings} expense={expense} />}
            <BudgetForm action={removeExpense.bind(null, tripId, expense.id, expense.revision)} label="지출 삭제" confirmDelete />
          </details>) : <p>표시할 지출이 없어요.</p>}
        </section>
        {settlement && <section className="editorial-paper suite-stack"><h2>인원별 정산</h2>
          <p>환불을 반영한 지출을 원화로 반올림한 뒤 균등 분할해요. 남는 1원씩은 별칭 목록 앞쪽부터 배정해요.</p>
          <ul>{settlement.people.map(({ id, paid, due }) => <li key={id}>
            <strong>{budget.people[id - 1]}</strong> · 지불 {wonLabel(paid)} · 부담 {wonLabel(due)} · {paid >= due ? "받을 금액 " + wonLabel(paid - due) : "보낼 금액 " + wonLabel(due - paid)}
          </li>)}</ul>
          <h3>송금 정리</h3>
          {settlement.transfers.length ? <ul>{settlement.transfers.map(({ from, to, amount }) =>
            <li key={from + ":" + to}>{budget.people[from - 1]} → {budget.people[to - 1]} · {wonLabel(amount)}</li>)}</ul> : <p>송금할 금액이 없어요.</p>}
        </section>}
      </>}
    </>}
    <TripTabs href={href} active="more" />
  </div>;
}
