import { placeLimits, providerIdPattern, validCoordinates } from "./trip-places.ts";

type Language = "ko" | "ja" | "en";
export type PlaceSuggestion = { id: string; name: string; address: string; latitude: number; longitude: number; language: Language };
export type GeoapifyResult = { status: "ok"; results: PlaceSuggestion[] } | { status: "unconfigured" | "limited" | "unavailable" };
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

export function normalizeQuery(value: string) {
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return text.length >= SEARCH_MIN && text.length <= SEARCH_MAX ? text : null;
}

export function searchLanguage(query: string): Language {
  if (/\p{Script=Hangul}/u.test(query)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(query)) return "ja";
  return "en";
}

export async function queryGeoapify(query: string, key: string, request: typeof fetch = fetch): Promise<GeoapifyResult> {
  if (!key) return { status: "unconfigured" };
  const language = searchLanguage(query);
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.search = new URLSearchParams({ text: query, lang: language, filter: "countrycode:jp", bias: "countrycode:jp",
    format: "json", limit: "5", apiKey: key }).toString();
  try {
    const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500) });
    if (response.status === 429) return { status: "limited" };
    if (!response.ok) return { status: "unavailable" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("results" in payload) || !Array.isArray(payload.results)) return { status: "unavailable" };
    const results = new Map<string, PlaceSuggestion>();
    for (const item of payload.results.slice(0, 10)) {
      if (!item || typeof item !== "object") continue;
      const { country_code, place_id: id, formatted, lat, lon } = item as Record<string, unknown>;
      const names = [item.name, item.address_line1, formatted];
      const name = names.find((value): value is string => typeof value === "string" && Boolean(value.trim()));
      if (country_code !== "jp" || !name || typeof id !== "string" || !providerIdPattern.test(id)
        || typeof lon !== "number" || !validCoordinates(lat, lon) || results.has(id)) continue;
      results.set(id, { id, name: name.trim().slice(0, placeLimits.name),
        address: typeof formatted === "string" ? formatted.trim().slice(0, placeLimits.address) : "",
        latitude: lat, longitude: lon, language });
      if (results.size === 5) break;
    }
    return { status: "ok", results: [...results.values()] };
  } catch {
    // A provider exception can include the API key or search text. Return a fixed status.
    return { status: "unavailable" };
  }
}
