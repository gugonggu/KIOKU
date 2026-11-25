import type { ScheduleFields } from "./database.types";
import type { Trip } from "./trip-details";
import { outsideTrip, parseSchedule } from "./trip-plan.ts";

export type TripImportRow = Pick<ScheduleFields, "title" | "local_date" | "time_mode" | "fixed_local_time" | "period">;
export type ImportPreviewRow = TripImportRow & { status: "new" | "duplicate" | "outside" };
export const importLimits = { rows: 30, text: 20000, fileBytes: 80000 };

export function normalizeTripImportText(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function parseTripImport(text: string): { rows: TripImportRow[] } | { error: string } {
  if (text.length > importLimits.text) return { error: "한 번에 최대 20,000자까지 붙여넣을 수 있어요." };
  let input: unknown;
  try { input = JSON.parse(text); } catch { return { error: "JSON 형식이 올바르지 않아요." }; }
  if (!Array.isArray(input) || !input.length || input.length > importLimits.rows) {
    return { error: "JSON 배열에 일정을 1~30개 넣어 주세요." };
  }
  const rows: TripImportRow[] = [];
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some((key) => !["title", "date", "time", "period"].includes(key)) ||
        typeof item.title !== "string" || [item.date, item.time, item.period].some((value) => value != null && typeof value !== "string") ||
        (item.time && item.period)) {
      return { error: (index + 1) + "번째 일정의 제목, 날짜 또는 시간 형식을 확인해 주세요." };
    }
    const data = new FormData();
    data.set("title", item.title);
    data.set("local_date", item.date ?? "");
    data.set("fixed_local_time", item.time ?? "");
    data.set("period", item.period ?? "");
    data.set("time_mode", item.time ? "FIXED" : item.period ? "PERIOD" : "UNSCHEDULED");
    const result = parseSchedule(data);
    if (typeof result === "string") return { error: (index + 1) + "번째 일정 · " + result };
    const { title, local_date, time_mode, fixed_local_time, period } = result;
    rows.push({ title, local_date, time_mode, fixed_local_time, period });
  }
  return { rows };
}

function signature(row: TripImportRow) {
  return JSON.stringify([row.title.trim().toLowerCase(), row.local_date, row.time_mode, row.fixed_local_time?.slice(0, 5), row.period]);
}

export function importPreview(rows: TripImportRow[], existing: TripImportRow[], trip: Pick<Trip, "start_date" | "end_date">): ImportPreviewRow[] {
  const keys = new Set(existing.map(signature));
  return rows.map((row) => {
    const key = signature(row);
    const status = outsideTrip(trip, row.local_date) ? "outside" : keys.has(key) ? "duplicate" : "new";
    keys.add(key);
    return { ...row, status };
  });
}
