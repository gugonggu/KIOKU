import assert from "node:assert/strict";
import test from "node:test";
import { koreanPlaceRetry } from "../src/lib/korean-romaji.ts";
import { destinationArea, placesArea, queryGeoapify, rankPlaces } from "../src/lib/geoapify.ts";

const row = (id, name, extra = {}) => ({ country_code: "jp", place_id: id, name, formatted: name + ", Japan", lat: 43.06, lon: 141.35, ...extra });

test("Korean spellings of Japanese places get one English-script retry query", () => {
  for (const [query, retry] of [
    ["니조 시장", "Nijo Market"], ["삿포로역", "Sapporo Station"], ["오타루역", "Otaru Station"],
    ["오도리 공원", "Odori Park"], ["홋카이도 대학", "Hokkaido University"], ["신주쿠역", "Shinjuku Station"],
    ["교토역", "Kyoto Station"], ["나고야성", "Nagoya Castle"], ["쓰키지 시장", "Tsukiji Market"], ["우메다", "Umeda"],
  ]) assert.equal(koreanPlaceRetry(query), retry, query);
  assert.equal(koreanPlaceRetry("Sapporo"), null);
  assert.equal(koreanPlaceRetry("札幌駅"), null);
  assert.equal(koreanPlaceRetry("역"), "Station");
});

test("searches near the trip merge a proximity-biased and a nationwide request", async () => {
  const biases = [];
  const result = await queryGeoapify("Sapporo Station", "fixture", async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("filter"), "countrycode:jp");
    biases.push(params.get("bias"));
    return Response.json({ results: params.get("bias").startsWith("proximity")
      ? [row("fixture-near", "Sapporo Station North Exit", { category: "public_transport.train" }), row("fixture-1", "Sapporo Station", { category: "public_transport.train", city: "Sapporo", district: "Kita Ward" })]
      : [row("fixture-1", "Sapporo Station", { category: "public_transport.train", city: "Sapporo", district: "Kita Ward" })] });
  }, { latitude: 43.06, longitude: 141.35 });
  assert.deepEqual(biases.sort(), ["countrycode:jp", "proximity:141.35,43.06|countrycode:jp"]);
  assert.deepEqual(result.results.map(({ id }) => id), ["fixture-1", "fixture-near"]);
  assert.deepEqual(result.results[0], { id: "fixture-1", name: "Sapporo Station", address: "Sapporo Station, Japan",
    latitude: 43.06, longitude: 141.35, language: "en", kind: "역", area: "Sapporo Kita Ward" });
  const plain = await queryGeoapify("Sapporo", "fixture", async (url) => {
    assert.equal(new URL(url).searchParams.get("bias"), "countrycode:jp");
    return Response.json({ results: [] });
  });
  assert.deepEqual(plain, { status: "ok", results: [] });
  // One failing request still returns the other request's places.
  const half = await queryGeoapify("Sapporo Station", "fixture", async (url) => new URL(url).searchParams.get("bias").startsWith("proximity")
    ? new Response(null, { status: 500 }) : Response.json({ results: [row("fixture-1", "Sapporo Station")] }), { latitude: 43, longitude: 141 });
  assert.deepEqual(half.results.map(({ id }) => id), ["fixture-1"]);
});

test("ranking prefers exact names, then places over streets, then the nearest branch", () => {
  const area = { latitude: 43.06, longitude: 141.35 };
  const rows = [
    { id: "tokyo", name: "根室花まる 銀座店", address: "", latitude: 35.67, longitude: 139.76, language: "ja", kind: "음식점" },
    { id: "far", name: "根室花まる", address: "", latitude: 43.33, longitude: 145.58, language: "ja", kind: "음식점" },
    { id: "near", name: "根室花まる", address: "", latitude: 43.07, longitude: 141.35, language: "ja", kind: "음식점" },
  ];
  assert.deepEqual(rankPlaces("根室花まる", rows, area).map(({ id }) => id), ["near", "far", "tokyo"]);
  const odori = [
    { id: "street", name: "오도리 공원", address: "", latitude: 43.0601, longitude: 141.3501, language: "ko", kind: "도로" },
    { id: "park", name: "오도리 공원", address: "", latitude: 43.06, longitude: 141.348, language: "ko", kind: "공원" },
  ];
  assert.deepEqual(rankPlaces("오도리 공원", odori, area).map(({ id }) => id), ["park", "street"]);
  assert.deepEqual(rankPlaces("Otaru Station", [
    { id: "power", name: "Ishikariwan Shinko power station", address: "", latitude: 43.19, longitude: 141.27, language: "en" },
    { id: "otaru", name: "Otaru station", address: "", latitude: 43.19, longitude: 140.99, language: "en", kind: "역" },
  ], area).map(({ id }) => id), ["otaru", "power"]);
  assert.deepEqual(rankPlaces("Dotonbori", [
    { id: "shop", name: "Dotonbori shop", address: "", latitude: 34.669, longitude: 135.502, language: "en" },
    { id: "landmark", name: "Dōtonbori", address: "", latitude: 34.669, longitude: 135.502, language: "en" },
  ]).map(({ id }) => id), ["landmark", "shop"]);
});

test("an empty Korean search retries once in English and reports the retry text", async () => {
  const calls = [];
  const result = await queryGeoapify("니조 시장", "fixture", async (url) => {
    const params = new URL(url).searchParams;
    calls.push([params.get("text"), params.get("lang")]);
    return Response.json({ results: params.get("lang") === "en" ? [row("fixture-nijo", "Nijo Market", { category: "commercial.marketplace" })] : [] });
  });
  assert.deepEqual(calls, [["니조 시장", "ko"], ["Nijo Market", "en"]]);
  assert.equal(result.alternate, "Nijo Market");
  assert.equal(result.results[0].kind, "시장");
  const found = [];
  const direct = await queryGeoapify("오도리 공원", "fixture", async (url) => {
    found.push(new URL(url).searchParams.get("text"));
    return Response.json({ results: [row("fixture-odori", "오도리 공원")] });
  });
  assert.deepEqual(found, ["오도리 공원"]);
  assert.equal(direct.alternate, undefined);
  // A provider failure on the first request is returned without a retry.
  assert.equal((await queryGeoapify("니조 시장", "fixture", async () => new Response(null, { status: 429 }))).status, "limited");
});

test("the trip area is the median of saved coordinates and a destination city lookup", async () => {
  assert.equal(placesArea([]), undefined);
  assert.equal(placesArea([{ latitude: null, longitude: null }]), undefined);
  assert.deepEqual(placesArea([
    { latitude: 43.06, longitude: 141.35 }, { latitude: 43.07, longitude: 141.36 }, { latitude: 35.6, longitude: 139.7 },
  ]), { latitude: 43.06, longitude: 141.35 });
  const area = await destinationArea("일본 홋카이도 · 삿포로 (가상)", "fixture", async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("text"), "삿포로");
    assert.equal(params.get("type"), "city");
    return Response.json({ results: [{ country_code: "jp", lat: 43.06, lon: 141.35 }] });
  });
  assert.deepEqual(area, { latitude: 43.06, longitude: 141.35 });
  assert.equal(await destinationArea("일본", "fixture", async () => { throw new Error("must not call"); }), undefined);
  assert.equal(await destinationArea("Seoul", "fixture", async () => Response.json({ results: [{ country_code: "kr", lat: 37.5, lon: 127 }] })), undefined);
});
