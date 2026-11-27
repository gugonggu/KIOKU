import { koreanPlaceRetry } from "./korean-romaji.ts";
import { placeLimits, providerIdPattern, validCoordinates } from "./trip-places.ts";

type Language = "ko" | "ja" | "en";
export type PlaceSuggestion = { id: string; name: string; address: string; latitude: number; longitude: number; language: Language;
  kind?: string; area?: string };
export type GeoapifyResult = { status: "ok"; results: PlaceSuggestion[]; alternate?: string } | { status: "unconfigured" | "limited" | "unavailable" };
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
// These inputs otherwise miss the landmark or rank nearby businesses above it.
const landmarkQueries = new Map([
  ["道頓堀", "大阪 道頓堀"],
  ["dotonbori", "Dotonbori Osaka"],
  ["삿포로 tv 타워", "さっぽろテレビ塔"],
]);
const placeNameOrder = new Intl.Collator("en", { usage: "search", sensitivity: "base" });

export function suggestionFields(row: PlaceSuggestion) {
  return { display_name: row.name, address_text: row.address, latitude: String(row.latitude), longitude: String(row.longitude),
    name_ko: row.language === "ko" ? row.name : "", name_ja: row.language === "ja" ? row.name : "",
    name_en: row.language === "en" ? row.name : "", address_ja: row.language === "ja" ? row.address : "",
    provider: "GEOAPIFY", provider_place_id: row.id };
}

export function normalizeQuery(value: string) {
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return text.length >= SEARCH_MIN && text.length <= SEARCH_MAX ? text : null;
}

export function searchLanguage(query: string): Language {
  if (/\p{Script=Hangul}/u.test(query)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(query)) return "ja";
  return "en";
}

export type SearchArea = { latitude: number; longitude: number };
type ProviderResult = { status: "ok"; results: PlaceSuggestion[] } | { status: "unconfigured" | "limited" | "unavailable" };

// Short Korean labels for Geoapify categories and result types. Unknown values stay unlabeled.
const kindLabels: [string, string][] = [
  ["public_transport.train", "역"], ["public_transport.subway", "지하철역"], ["railway", "역"], ["public_transport", "교통"],
  ["airport", "공항"], ["catering.cafe", "카페"], ["catering", "음식점"], ["accommodation", "숙소"],
  ["commercial.supermarket", "슈퍼마켓"], ["commercial.marketplace", "시장"], ["commercial.department_store", "백화점"],
  ["commercial", "상점"], ["entertainment.museum", "박물관"], ["entertainment", "명소"], ["leisure.park", "공원"],
  ["leisure", "여가"], ["tourism", "관광지"], ["religion", "사찰·신사"], ["natural", "자연"], ["service.post", "우체국"],
  ["building", "건물"], ["education", "학교"], ["healthcare", "병원"],
];
const typeLabels: Record<string, string> = { street: "도로", suburb: "지역", district: "지역", city: "도시", county: "지역", state: "지역", postcode: "우편번호" };

function textOf(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function placeKind(item: Record<string, unknown>) {
  const categories = Array.isArray(item.categories) ? item.categories : [item.category];
  for (const category of categories.filter((value): value is string => typeof value === "string")) {
    const match = kindLabels.find(([prefix]) => category === prefix || category.startsWith(prefix + "."));
    if (match) return match[1];
  }
  return typeLabels[textOf(item.result_type)] ?? "";
}

function placeArea(item: Record<string, unknown>) {
  const parts = [textOf(item.city) || textOf(item.county) || textOf(item.state), textOf(item.district) || textOf(item.suburb)];
  return [...new Set(parts.filter(Boolean))].join(" ").slice(0, 80);
}

async function requestPlaces(text: string, language: Language, key: string, request: typeof fetch,
  area?: SearchArea, type?: string): Promise<ProviderResult> {
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  const bias = (area ? `proximity:${area.longitude},${area.latitude}|` : "") + "countrycode:jp";
  url.search = new URLSearchParams({ text, lang: language, filter: "countrycode:jp", bias,
    ...(type && { type }), format: "json", limit: "5", apiKey: key }).toString();
  const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500) });
  if (response.status === 429) return { status: "limited" };
  if (response.status === 401 || response.status === 403) return { status: "unconfigured" };
  if (!response.ok) return { status: "unavailable" };
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("results" in payload) || !Array.isArray(payload.results)) return { status: "unavailable" };
  const results = new Map<string, PlaceSuggestion>();
  for (const item of payload.results.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const { country_code, place_id: id, formatted, lat, lon } = row;
    const name = [row.name, row.address_line1, formatted].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    if (country_code !== "jp" || !name || typeof id !== "string" || !providerIdPattern.test(id)
      || typeof lon !== "number" || !validCoordinates(lat, lon) || results.has(id)) continue;
    const kind = placeKind(row);
    const where = placeArea(row);
    results.set(id, { id, name: name.trim().slice(0, placeLimits.name),
      address: typeof formatted === "string" ? formatted.trim().slice(0, placeLimits.address) : "",
      latitude: lat, longitude: lon, language, ...(kind && { kind }), ...(where && { area: where }) });
    if (results.size === 5) break;
  }
  return { status: "ok", results: [...results.values()] };
}

const stationKinds = new Set(["역", "지하철역"]);

export async function queryGeoapify(query: string, key: string, request: typeof fetch = fetch,
  area?: SearchArea): Promise<GeoapifyResult> {
  if (!key) return { status: "unconfigured" };
  const language = searchLanguage(query);
  const alias = landmarkQueries.get(query.toLowerCase());
  try {
    const first = await requestPlaces(alias ?? query, language, key, request, area);
    if (first.status !== "ok") return first;
    let results = first.results;
    let alternate: string | undefined;
    // Japanese station names are often stored without 駅. Ask once more for stations only.
    if (language === "ja" && !alias && /\S駅$/u.test(query) && !results.some(({ kind }) => kind && stationKinds.has(kind))) {
      const stations = await requestPlaces(query.slice(0, -1), language, key, request, area, "amenity");
      if (stations.status === "ok") {
        const found = stations.results.filter(({ kind }) => kind && stationKinds.has(kind));
        results = [...found, ...results.filter(({ id }) => !found.some((row) => row.id === id))].slice(0, 5);
      }
    }
    // Korean names exist only for some places. Retry once with the English spelling and label it in the UI.
    if (language === "ko" && !alias && !results.length) {
      const retry = koreanPlaceRetry(query);
      if (retry) {
        const second = await requestPlaces(retry, "en", key, request, area);
        if (second.status === "ok" && second.results.length) { results = second.results; alternate = retry; }
      }
    }
    const exact = (name: string) => placeNameOrder.compare(name, alternate ?? query) === 0;
    const ordered = [...results].sort((first, second) => Number(exact(second.name)) - Number(exact(first.name)));
    return alternate ? { status: "ok", results: ordered, alternate } : { status: "ok", results: ordered };
  } catch {
    // A provider exception can include the API key or search text. Return a fixed status.
    return { status: "unavailable" };
  }
}

/** Median of a trip's saved coordinates. It anchors search results near places the user already chose. */
export function placesArea(rows: { latitude: number | string | null; longitude: number | string | null }[]): SearchArea | undefined {
  const points = rows.map(({ latitude, longitude }) => [Number(latitude), Number(longitude)] as const)
    .filter(([latitude, longitude]) => latitude !== 0 && validCoordinates(latitude, longitude));
  if (!points.length) return undefined;
  const middle = (values: number[]) => {
    const sorted = [...values].sort((first, second) => first - second);
    const half = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
  };
  return { latitude: middle(points.map(([latitude]) => latitude)), longitude: middle(points.map(([, longitude]) => longitude)) };
}

/** Looks up the city named in a trip destination such as "일본 홋카이도 · 삿포로". */
export async function destinationArea(label: string, key: string, request: typeof fetch = fetch): Promise<SearchArea | undefined> {
  const segments = label.normalize("NFKC").replace(/\([^)]*\)/g, " ").split(/[·,/|]/)
    .map((part) => part.trim()).filter((part) => part.length >= 2 && part !== "일본" && part.toLowerCase() !== "japan");
  const name = segments.at(-1);
  if (!name || !key) return undefined;
  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.search = new URLSearchParams({ text: name, lang: searchLanguage(name), type: "city", filter: "countrycode:jp",
      format: "json", limit: "1", apiKey: key }).toString();
    const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4500) });
    if (!response.ok) return undefined;
    const payload = await response.json() as { results?: { lat?: unknown; lon?: unknown; country_code?: unknown }[] };
    const row = payload.results?.[0];
    return row?.country_code === "jp" && typeof row.lat === "number" && typeof row.lon === "number" && validCoordinates(row.lat, row.lon)
      ? { latitude: row.lat, longitude: row.lon } : undefined;
  } catch {
    return undefined;
  }
}
