import { isCalendarDate } from "./trip-details.ts";

export const visitStatuses = { planned: "방문 예정", visited: "방문 완료", missed: "방문하지 못함" } as const;
export type VisitStatus = keyof typeof visitStatuses;
export type VisitMark = { trip_id: string; schedule_id: string; status: VisitStatus };
export type MemoryEntryFields = { day: string; title: string; body: string; place_id: string | null; schedule_id: string | null };
export type MemoryEntry = MemoryEntryFields & { id: string; trip_id: string; created_at: string };
export type MemoryPhotoFields = { day: string; title: string; caption: string | null; entry_id: string | null; place_id: string | null };
export type MemoryPhoto = MemoryPhotoFields & {
  id: string; trip_id: string; phase: "pending" | "ready" | "deleting"; width: number | null; height: number | null;
  bytes: number | null; is_cover: boolean; sort_order: number; created_at: string;
};

function read(form: FormData, field: string) {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function optionalId(form: FormData, field: string) {
  const value = read(form, field);
  return !value ? null : /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}

function dateAndTitle(form: FormData) {
  const day = read(form, "day");
  const title = read(form, "title");
  return isCalendarDate(day) && title && title.length <= 100 ? { day, title } : null;
}

export function readMemoryEntry(form: FormData): MemoryEntryFields | null {
  const basic = dateAndTitle(form);
  const body = read(form, "body");
  const place_id = optionalId(form, "place");
  const schedule_id = optionalId(form, "schedule");
  if (!basic || !body || body.length > 4000 || place_id === undefined || schedule_id === undefined) return null;
  return { ...basic, body, place_id, schedule_id };
}

export function readMemoryPhoto(form: FormData): MemoryPhotoFields | null {
  const basic = dateAndTitle(form);
  const caption = read(form, "caption");
  const place_id = optionalId(form, "place");
  const entry_id = optionalId(form, "entry");
  if (!basic || caption.length > 500 || place_id === undefined || entry_id === undefined) return null;
  return { ...basic, caption: caption || null, place_id, entry_id };
}

export function tripMemoryDays(...groups: ReadonlyArray<ReadonlyArray<{ day: string }>>) {
  return [...new Set(groups.flatMap((group) => group.map(({ day }) => day)))].sort();
}

export function memoryPhotoHref(tripId: string, id: string) {
  return "/api/memory/" + tripId + "/" + id;
}
