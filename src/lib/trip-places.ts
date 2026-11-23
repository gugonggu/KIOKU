import type { PlaceFields } from "./database.types";

export const placeLimits = { name: 100, address: 240, notes: 1500 } as const;
export const providerIdPattern = /^[A-Za-z0-9._:-]{1,256}$/;
const decimal = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function validCoordinates(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

export function parsePlace(data: FormData): PlaceFields | string {
  const read = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const name = read("display_name");
  const nameKo = read("name_ko");
  const nameJa = read("name_ja");
  const nameEn = read("name_en");
  const address = read("address_text");
  const addressJa = read("address_ja");
  const notes = read("notes");
  if (!name || [name, nameKo, nameJa, nameEn].some((entry) => entry.length > placeLimits.name)) return "장소 이름을 1~100자로 입력해 주세요.";
  if ([address, addressJa].some((entry) => entry.length > placeLimits.address) || notes.length > placeLimits.notes) {
    return "주소는 각각 240자, 메모는 1,500자까지 입력할 수 있어요.";
  }
  const lat = read("latitude");
  const lon = read("longitude");
  if ((lat || lon) && (!decimal.test(lat) || !decimal.test(lon) || !validCoordinates(Number(lat), Number(lon)))) {
    return "올바른 위도(-90~90)와 경도(-180~180)를 둘 다 입력해 주세요.";
  }
  const source = read("provider") || "MANUAL";
  const sourceId = read("provider_place_id");
  if ((source !== "MANUAL" && source !== "GEOAPIFY") || (source === "MANUAL" && sourceId)
    || (source === "GEOAPIFY" && (!providerIdPattern.test(sourceId) || !lat || !lon))) {
    return "검색 결과를 다시 선택하거나 직접 등록해 주세요.";
  }
  return {
    display_name: name, name_ko: nameKo || null, name_ja: nameJa || null, name_en: nameEn || null,
    address_text: address || null, address_ja: addressJa || null, notes: notes || null,
    latitude: lat ? Number(lat) : null, longitude: lon ? Number(lon) : null,
    provider: source, provider_place_id: sourceId || null,
  };
}

export function directionsUrl(place: Pick<PlaceFields, "latitude" | "longitude" | "address_text" | "address_ja">) {
  const address = [place.address_ja, place.address_text].find((value) =>
    value && (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2);
  const destination = place.latitude !== null && place.longitude !== null
    ? `${place.latitude},${place.longitude}` : address;
  return destination ? `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination })}` : null;
}

export type PlaceFilter = "all" | "date" | "candidates";
export type PlaceLink = { place_id: string | null; local_date: string | null };

export function filterPlaces<Place extends { id: string }>(places: Place[], links: PlaceLink[], filter: PlaceFilter, date: string | null) {
  if (filter === "all") return places;
  const linked = new Set(links.map(({ place_id }) => place_id));
  const visible = new Set(links.filter(({ local_date }) => local_date === (filter === "candidates" ? null : date))
    .map(({ place_id }) => place_id));
  return places.filter(({ id }) => visible.has(id) || (filter === "candidates" && !linked.has(id)));
}
