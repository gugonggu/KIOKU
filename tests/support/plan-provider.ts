import { asUser, type createTripsDatabase } from "./trips-db.mjs";

type Database = Awaited<ReturnType<typeof createTripsDatabase>>;
type Json = Record<string, unknown>;

export async function handlePlanRequest({ database, userId, method, url, readJson, send, failedSaves }: {
  database: Database;
  userId?: string;
  method?: string;
  url: URL;
  readJson: () => Promise<Json>;
  send: (status: number, payload: object | boolean | string | null) => void;
  failedSaves: Set<string>;
}) {
  if (url.pathname === "/rest/v1/rpc/read_shared_trip" && method === "POST") {
    const { p_proof } = await readJson();
    const { rows } = await asUser(database, userId ?? null,
      (tx) => tx.query<{ result: object | null }>("select public.read_shared_trip($1) as result", [p_proof]));
    return send(200, rows[0].result);
  }
  if (!userId) return send(401, { message: "fixture session required" });
  if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST") {
    const body = await readJson();
    let query: string;
    let args: unknown[];
    switch (url.pathname) {
      case "/rest/v1/rpc/read_share_settings":
        query = "select public.read_share_settings($1,$2) as result";
        args = [body.p_trip, body.p_preview];
        break;
      case "/rest/v1/rpc/write_share_settings":
        query = "select public.write_share_settings($1,$2,$3,$4,$5,$6,$7,$8) as result";
        args = [body.p_trip, body.p_revision, body.p_mode, body.p_expiry, body.p_bookings, body.p_notes, body.p_hash, body.p_cipher];
        break;
      case "/rest/v1/rpc/save_booking":
        query = "select public.save_booking($1,$2,$3,$4) as result";
        args = [body.p_trip, body.p_id, body.p_version, body.p_fields];
        break;
      case "/rest/v1/rpc/delete_booking":
        query = "select public.delete_booking($1,$2,$3,$4) as result";
        args = [body.p_trip, body.p_id, body.p_version, body.p_expected];
        break;
      case "/rest/v1/rpc/save_trip_place":
        query = "select public.save_trip_place($1,$2,$3,$4,$5) as result";
        args = [body.p_trip,body.p_id,body.p_version,body.p_fields,body.p_confirm];
        break;
      case "/rest/v1/rpc/delete_trip_place":
        query = "select public.delete_trip_place($1,$2,$3,$4) as result";
        args = [body.p_trip,body.p_id,body.p_version,body.p_expected_count];
        break;
      case "/rest/v1/rpc/authorize_place_search":
        query = "select public.authorize_place_search($1) as result";
        args = [body.p_trip];
        break;
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
  const columns = url.searchParams.get("select");
  const booking = url.searchParams.get("booking_id")?.match(/^eq\.(.+)$/)?.[1] ?? null;
  let query: string;
  switch (url.pathname) {
    case "/rest/v1/bookings":
      query = columns === "id,kind,title,status" ?
        "select id,kind,title,status from public.bookings where trip_id=$1 order by title,id" :
        "select id,kind,title,status,shared_note,content_version from public.bookings where trip_id=$1 order by id";
      break;
    case "/rest/v1/flight_segments":
      query = "select booking_id,id,segment_order,airline_name,flight_number,departure_airport,arrival_airport," +
        " departure_local_date::text,arrival_local_date::text,departure_local_time::text,arrival_local_time::text," +
        " departure_timezone,arrival_timezone from public.flight_segments where trip_id=$1 order by booking_id,segment_order";
      break;
    case "/rest/v1/stay_details":
      query = "select booking_id,address_text,check_in_local_date::text,check_out_local_date::text," +
        " check_in_local_time::text,check_out_local_time::text,guest_count,room_count from public.stay_details where trip_id=$1 order by booking_id";
      break;
    case "/rest/v1/tour_details":
      query = "select booking_id,event_local_date::text,event_local_time::text,meeting_local_time::text," +
        " meeting_place_name,meeting_address_text,meeting_latitude,meeting_longitude from public.tour_details where trip_id=$1 order by booking_id";
      break;
    case "/rest/v1/booking_private_details":
      query = "select confirmation_reference,amount::float8,currency,private_note from public.booking_private_details where trip_id=$1 and booking_id=$4";
      break;
    case "/rest/v1/itinerary_items":
      if (booking) query = "select id,title,local_date::text,time_mode,fixed_local_time::text,period from public.itinerary_items" +
        " where trip_id=$1 and booking_id=$4 order by local_date,id";
      else if (columns === "place_id,local_date") query = "select place_id,local_date::text from public.itinerary_items where trip_id=$1 and place_id is not null order by id";
      else query = "select id,title,kind,time_mode,local_date::text,fixed_local_time::text,period,place_id,booking_id,private_note," +
        " shared_note,revision,sort_order::float8,archived_date::text from public.itinerary_items where trip_id=$1 order by local_date,id";
      break;
    default:
      query = columns === "id,name:display_name,address:address_text"
        ? "select id,display_name as name,address_text as address from public.trip_places where trip_id=$1 order by display_name,id"
        : "select id,display_name,name_ko,name_ja,name_en,address_text,address_ja,latitude,longitude,notes," +
          " provider,provider_place_id,content_version from public.trip_places where trip_id=$1 order by display_name,id";
  }
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const args = booking ? [trip, limit, offset, booking] : [trip, limit, offset];
  const { rows } = await asUser(database, userId, (tx) => tx.query(query + " limit $2 offset $3", args));
  return send(200, rows);
}
