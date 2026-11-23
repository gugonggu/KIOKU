"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseBooking } from "@/lib/trip-bookings";
import { isCalendarDate } from "@/lib/trip-details";
import { getTrip, isTripId, requireTripClient } from "@/lib/trips";
import { bookingsHref } from "./links";

export type BookingState = { error?: string; refresh?: boolean };
const changed = { error: "예약 정보가 변경됐어요. 최신 정보를 확인해 주세요.", refresh: true };

async function bookingClient(tripId: string, id: string, version: number | null) {
  if (!isTripId(tripId) || !isTripId(id) || (version !== null && (!Number.isInteger(version) || version < 1))) return null;
  const { data, error } = await getTrip(tripId);
  if (!data || error) return null;
  return (await requireTripClient()).client;
}

function finish(tripId: string, date: string | null, id?: string): never {
  const root = "/trips/" + tripId;
  revalidatePath(root);
  revalidatePath(root + "/bookings");
  revalidatePath(root + "/itinerary");
  return redirect(bookingsHref(tripId, date && isCalendarDate(date) ? date : null, id ? "view" : undefined, id));
}

export async function saveBooking(tripId: string, id: string, version: number | null, date: string | null,
  _state: BookingState, form: FormData): Promise<BookingState> {
  const client = await bookingClient(tripId, id, version);
  if (!client) return changed;
  const fields = parseBooking(form);
  if (typeof fields === "string") return { error: fields };
  const { data, error } = await client.rpc("save_booking", { p_trip: tripId, p_id: id, p_version: version, p_fields: fields });
  if (error?.code === "22023") return { error: "항공 구간의 공항 시간대를 확인해 주세요." };
  if (error) return { error: "예약을 저장하지 못했어요. 입력은 유지됐어요." };
  if (data === "saved" || data === "existing") return finish(tripId, date, id);
  return changed;
}

export async function deleteBooking(tripId: string, id: string, version: number, date: string | null,
  expected: string[]): Promise<BookingState> {
  const client = await bookingClient(tripId, id, version);
  if (!client) return changed;
  const { data, error } = await client.rpc("delete_booking", { p_trip: tripId, p_id: id, p_version: version, p_expected: expected });
  if (error) return { error: "예약을 삭제하지 못했어요. 다시 시도해 주세요." };
  if (data === "deleted") return finish(tripId, date);
  if (data === "preview") return { error: "연결된 일정이 바뀌었어요. 삭제 전에 다시 확인해 주세요.", refresh: true };
  return changed;
}
