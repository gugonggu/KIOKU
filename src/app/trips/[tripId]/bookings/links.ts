export function bookingsHref(tripId: string, date?: string | null, mode?: "add" | "view" | "edit" | "delete", id?: string) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (mode) query.set("mode", mode);
  if (id) query.set("id", id);
  const search = query.toString();
  return "/trips/" + tripId + "/bookings" + (search ? "?" + search : "");
}
