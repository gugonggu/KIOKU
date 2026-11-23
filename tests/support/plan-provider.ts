import { asUser, type createTripsDatabase } from "./trips-db.mjs";

type Database = Awaited<ReturnType<typeof createTripsDatabase>>;
type Json = Record<string, unknown>;

export async function handlePlanRequest({ database, userId, method, url, readJson, send, failedSaves }: {
  database: Database;
  userId?: string;
  method?: string;
  url: URL;
  readJson: () => Promise<Json>;
  send: (status: number, payload: object | boolean | string) => void;
  failedSaves: Set<string>;
}) {
  if (!userId) return send(401, { message: "fixture session required" });
  if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST") {
    const body = await readJson();
    let query: string;
    let args: unknown[];
    switch (url.pathname) {
      case "/rest/v1/rpc/update_trip_period":
        query = "select public.update_trip_period($1,$2,$3,$4) as result";
        args = [body.p_trip, body.p_version, body.p_fields, body.p_expected === null ? null : JSON.stringify(body.p_expected)];
        break;
      case "/rest/v1/rpc/save_itinerary_item": {
        const { p_trip, p_item, p_revision, p_trip_version, p_fields } = body;
        const fields = p_fields as Json;
        if (fields.title === "테스트 저장 재시도" && typeof p_item === "string" && !failedSaves.has(p_item)) {
          failedSaves.add(p_item);
          return send(503, { message: "fixture itinerary temporarily unavailable" });
        }
        query = "select public.save_itinerary_item($1,$2,$3,$4,$5) as result";
        args = [p_trip, p_item, p_revision, p_trip_version, p_fields];
        break;
      }
      case "/rest/v1/rpc/swap_itinerary_items":
        query = "select public.swap_itinerary_items($1,$2,$3,$4,$5) as result";
        args = [body.p_trip, body.p_first, body.p_first_version, body.p_second, body.p_second_version];
        break;
      case "/rest/v1/rpc/place_itinerary_item":
        query = "select public.place_itinerary_item($1,$2,$3,$4,$5,$6) as result";
        args = [body.p_trip, body.p_item, body.p_revision, body.p_command, body.p_date, body.p_trip_version];
        break;
      default:
        return send(404, { message: "fixture unknown procedure" });
    }
    const { rows } = await asUser(database, userId, (tx) => tx.query<{ result: string | boolean | object }>(query, args));
    return send(200, rows[0].result);
  }

  if (method !== "GET") return send(405, { message: "fixture unsupported method" });
  const trip = url.searchParams.get("trip_id")?.match(/^eq\.(.+)$/)?.[1];
  if (!trip) return send(400, { message: "fixture trip filter missing" });
  const itinerary = url.pathname === "/rest/v1/itinerary_items";
  const query = itinerary ? `select id,title,kind,time_mode,local_date::text,fixed_local_time::text,period,place_id,private_note,
        shared_note,revision,sort_order::float8,archived_date::text from public.itinerary_items where trip_id = $1 order by local_date,id`
      : "select id,name,address from public.trip_places where trip_id = $1 order by name,id";
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const { rows } = await asUser(database, userId, (tx) => tx.query(`${query} limit $2 offset $3`, [trip, limit, offset]));
  return send(200, rows);
}
