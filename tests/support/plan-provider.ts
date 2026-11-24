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
  if (url.pathname === "/rest/v1/trip_memory_entries" && method !== "GET") {
    const trip = url.searchParams.get("trip_id")?.slice(3);
    const id = url.searchParams.get("id")?.slice(3);
    const { rows } = await asUser(database, userId, async (tx) => {
      if (method === "DELETE") return tx.query("delete from public.trip_memory_entries where trip_id=$1 and id=$2 returning id", [trip,id]);
      const body = await readJson();
      const values = [body.day,body.title,body.body,body.place_id,body.schedule_id];
      if (method === "POST") return tx.query("insert into public.trip_memory_entries(id,trip_id,day,title,body,place_id,schedule_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [body.id,body.trip_id,...values]);
      return tx.query("update public.trip_memory_entries set day=$3,title=$4,body=$5,place_id=$6,schedule_id=$7 where trip_id=$1 and id=$2 returning id",[trip,id,...values]);
    });
    return send(method === "POST" ? 201 : 200, rows[0] as Json ?? null);
  }
  if (url.pathname === "/rest/v1/trip_expenses" && method !== "GET") {
    const trip = url.searchParams.get("trip_id")?.slice(3);
    const id = url.searchParams.get("id")?.slice(3);
    const revision = url.searchParams.get("revision")?.slice(3);
    const { rows } = await asUser(database, userId, async (tx) => {
      if (method === "DELETE") return tx.query("delete from public.trip_expenses where trip_id=$1 and id=$2 and revision=$3 returning id", [trip, id, revision]);
      const body = await readJson();
      const keys = ["title", "amount", "refund", "currency", "rate", "spent_on", "category", "payer", "shares", "method", "prepaid", "note", "booking_id"];
      const values = keys.map((key) => body[key]);
      if (method === "POST") return tx.query(
        "insert into public.trip_expenses(id,trip_id," + keys.join(",") + ") values (" +
        Array.from({ length: values.length + 2 }, (_, i) => "$" + (i + 1)).join(",") + ") returning id",
        [body.id, body.trip_id, ...values]);
      return tx.query("update public.trip_expenses set " + keys.map((key, i) => key + "=$" + (i + 4)).join(",") +
        " where trip_id=$1 and id=$2 and revision=$3 returning id", [trip, id, revision, ...values]);
    });
    return send(method === "POST" ? 201 : 200, rows);
  }
  if (url.pathname === "/rest/v1/trip_preparation" && method !== "GET") {
    const trip = url.searchParams.get("trip_id")?.slice(3);
    const id = url.searchParams.get("id")?.slice(3);
    await asUser(database, userId, async (tx) => {
      if (method === "DELETE") {
        await tx.query("delete from public.trip_preparation where trip_id=$1 and id=$2", [trip, id]);
        return;
      }
      const body = await readJson();
      if (method === "POST") {
        await tx.query("insert into public.trip_preparation (trip_id,title,category,due_date,note) values ($1,$2,$3,$4,$5)",
          [body.trip_id, body.title, body.category, body.due_date, body.note]);
      } else if (method === "PATCH" && "done" in body) {
        await tx.query("update public.trip_preparation set done=$3 where trip_id=$1 and id=$2", [trip,id,body.done]);
      } else if (method === "PATCH") {
        await tx.query("update public.trip_preparation set title=$3,category=$4,due_date=$5,note=$6 where trip_id=$1 and id=$2",
          [trip,id,body.title,body.category,body.due_date,body.note]);
      }
    });
    return send(method === "POST" ? 201 : 204, null);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST") {
    const body = await readJson();
    let query: string;
    let args: unknown[];
    switch (url.pathname) {
      case "/rest/v1/rpc/set_trip_visit":
        query = "select public.set_trip_visit($1,$2,$3) as result";
        args = [body.p_trip,body.p_schedule,body.p_status];
        break;
      case "/rest/v1/rpc/save_trip_budget":
        query = "select public.save_trip_budget($1,$2,$3,$4) as result";
        args = [body.p_trip, body.p_amount, body.p_rate, body.p_people];
        break;
      case "/rest/v1/rpc/apply_preparation_template":
        query = "select public.apply_preparation_template($1,$2) as result";
        args = [body.p_trip, JSON.stringify(body.p_items)];
        break;
      case "/rest/v1/rpc/move_preparation":
        query = "select public.move_preparation($1,$2,$3) as result";
        args = [body.p_trip, body.p_id, body.p_direction];
        break;
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
    case "/rest/v1/trip_memory_entries":
      query = "select id,trip_id,day::text,title,body,place_id,schedule_id,created_at from public.trip_memory_entries where trip_id=$1 order by day,created_at,id";
      break;
    case "/rest/v1/trip_memory_photos":
      query = "select * from public.trip_memory_photos where trip_id=$1 order by day,sort_order,id";
      break;
    case "/rest/v1/trip_visit_marks":
      query = "select trip_id,schedule_id,status from public.trip_visit_marks where trip_id=$1 order by schedule_id";
      break;
    case "/rest/v1/trip_budgets":
      query = "select trip_id,budget_krw,rate,people from public.trip_budgets where trip_id=$1";
      break;
    case "/rest/v1/trip_expenses":
      query = "select id,trip_id,title,amount,refund,currency,rate,spent_on::text,category,payer,shares,method,prepaid,note,booking_id,revision" +
        " from public.trip_expenses where trip_id=$1 order by spent_on desc,id";
      break;
    case "/rest/v1/trip_preparation":
      query = "select id,trip_id,title,category,done,due_date::text,note,sort_order::float8,source from public.trip_preparation where trip_id=$1 order by sort_order,id";
      break;
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
      else if (columns === "id,place_id,local_date,title,time_mode,fixed_local_time,period") query =
        "select id,place_id,local_date::text,title,time_mode,fixed_local_time::text,period from public.itinerary_items" +
        " where trip_id=$1 and place_id is not null order by local_date,id";
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
