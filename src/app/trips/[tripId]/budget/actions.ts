"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCalendarDate } from "@/lib/trip-details";
import { loadPrivateBooking } from "@/lib/trip-booking-data";
import { expenseCategories, parseRate, type ExpenseCategory, type ExpenseFields } from "@/lib/trip-budget";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";

const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const settlementPeopleError = "지출이 있는 정산 인원의 이름과 순서를 유지하고, 새 인원은 마지막에 추가해 주세요.";

function integer(value: string, minimum: number, maximum: number) {
  if (!/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return number >= minimum && number <= maximum ? number : null;
}

function refresh(trip: string): never {
  const home = "/trips/" + trip;
  revalidatePath(home);
  revalidatePath(home + "/budget");
  revalidatePath(home + "/guide");
  redirect(home + "/budget");
}

export async function saveBudget(trip: string, _state: string, data: FormData) {
  const { client } = await requireTripClient();
  if (!(await getTrip(trip)).data) return "여행을 확인해 주세요.";
  const amount = integer(field(data, "budget") || "0", 0, 1000000000);
  const rawRate = field(data, "rate");
  const rate = rawRate ? parseRate(rawRate) : null;
  const people = field(data, "people").split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (amount === null || (rawRate && rate === null) || people.length < 1 || people.length > 12 ||
    people.some((name) => name.length > 30) || new Set(people.map((name) => name.toLowerCase())).size !== people.length) {
    return "예산, 입력한 환율과 중복 없는 동행자 이름을 확인해 주세요. 예산과 환율은 비워 둘 수 있어요.";
  }
  const [current, expenses] = await Promise.all([
    client.from("trip_budgets").select("people").eq("trip_id", trip).maybeSingle(),
    client.from("trip_expenses").select("id").eq("trip_id", trip).limit(1),
  ]);
  if (current.error || expenses.error) return "현재 정산 인원을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
  if (expenses.data.length && current.data?.people.some((name, index) => name !== people[index])) {
    return settlementPeopleError;
  }
  const { error } = await client.rpc("save_trip_budget", { p_trip: trip, p_amount: amount, p_rate: rate, p_people: people });
  if (error) return error.code === "23514" ? settlementPeopleError : "예산을 저장하지 못했어요.";
  return refresh(trip);
}

export async function saveExpense(trip: string, id: string, revision: number | null, _state: string, data: FormData) {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return "여행과 지출을 확인해 주세요.";
  const spentOn = field(data, "date");
  const category = field(data, "category") as ExpenseCategory;
  if (!Object.hasOwn(expenseCategories, category)) return "카테고리를 확인해 주세요.";
  const title = field(data, "title") || expenseCategories[category];
  const bookingId = field(data, "booking") || null;
  const payer = integer(field(data, "payer"), 1, 12);
  const shares = data.getAll("shares").map((value) => integer(String(value), 1, 12));
  const method = field(data, "method");
  const note = field(data, "note");
  const refund = integer(field(data, "refund") || "0", 0, 1000000000);
  let currency = field(data, "currency");
  let amount = integer(field(data, "amount"), 1, 1000000000);
  if (bookingId && !isTripId(bookingId)) return "같은 여행의 예약을 선택해 주세요.";
  if (data.has("copyBooking") && bookingId) {
    const { data: booking } = await loadPrivateBooking(trip, bookingId);
    if (!booking?.amount || !Number.isInteger(booking.amount) || !["JPY", "KRW"].includes(booking.currency ?? "")) {
      return "선택한 예약에는 사용할 수 있는 원화·엔화 예약 금액이 없어요.";
    }
    amount = integer(String(booking.amount), 1, 1000000000);
    currency = booking.currency!;
  }
  const rate = currency === "KRW" ? 10000 : parseRate(field(data, "rate"));
  if (currency === "JPY" && field(data, "rate") && rate === null) return "입력한 환율을 확인하거나 비워 두세요.";
  if (payer === null || !shares.length || shares.some((share) => share === null)) {
    return "결제자와 분담 대상을 선택해 주세요.";
  }
  if (title.length > 100 || !isCalendarDate(spentOn) || !["KRW", "JPY"].includes(currency)
    || amount === null || refund === null || refund > amount
    || method.length > 40 || note.length > 500) return "금액, 날짜, 환율 등 입력값을 확인해 주세요.";
  const values: ExpenseFields = { title, amount, refund, currency: currency as "KRW" | "JPY", rate,
    spent_on: spentOn, category, payer, shares: shares as number[], method: method || null,
    prepaid: field(data, "phase") === "prepaid", note: note || null, booking_id: bookingId };
  const result = revision === null
    ? await client.from("trip_expenses").insert({ id, trip_id: trip, ...values }).select("id")
    : await client.from("trip_expenses").update(values).eq("trip_id", trip).eq("id", id).eq("revision", revision).select("id");
  if (result.error?.code === "23505") return "이미 이 예약에 연결된 지출이 있어요. 기존 지출에서 결제액을 갱신해 주세요.";
  if (result.error) return "지출을 저장하지 못했어요. 정산 인원과 연결 예약을 확인해 주세요.";
  if (!result.data?.length) return "지출이 다른 화면에서 변경됐어요. 새로고침해 주세요.";
  return refresh(trip);
}

export async function removeExpense(trip: string, id: string, revision: number) {
  const { client } = await requireTripClient();
  if (!isTripId(id) || !(await getTrip(trip)).data) return "여행과 지출을 확인해 주세요.";
  const { data, error } = await client.from("trip_expenses").delete().eq("trip_id", trip).eq("id", id).eq("revision", revision).select("id");
  if (error || !data?.length) return "지출을 삭제하지 못했어요. 새로고침하고 다시 확인해 주세요.";
  return refresh(trip);
}
