import "server-only";
import { readRows } from "./trip-plan-data";
import { requireTripClient } from "./trips";

export async function loadBudget(tripId: string) {
  const { client } = await requireTripClient();
  const [result, expenses] = await Promise.all([
    client.from("trip_budgets").select("trip_id,budget_krw,rate,people").eq("trip_id", tripId).maybeSingle(),
    readRows((start, end) => client.from("trip_expenses").select("*").eq("trip_id", tripId)
      .order("spent_on", { ascending: false }).order("id").range(start, end)),
  ]);
  return result.error || !expenses ? null : { budget: result.data, expenses };
}
