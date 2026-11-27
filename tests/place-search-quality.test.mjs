import assert from "node:assert/strict";
import test from "node:test";
import { koreanPlaceRetry } from "../src/lib/korean-romaji.ts";
import { destinationArea, placesArea, queryGeoapify } from "../src/lib/geoapify.ts";

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

test("searches near the trip area keep the Japan filter and add a proximity bias", async () => {
  const result = await queryGeoapify("Sapporo", "fixture", async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("filter"), "countrycode:jp");
    assert.equal(params.get("bias"), "proximity:141.35,43.06|countrycode:jp");
    return Response.json({ results: [row("fixture-1", "Sapporo Station", { category: "public_transport.train", city: "Sapporo", district: "Kita Ward" })] });
  }, { latitude: 43.06, longitude: 141.35 });
  assert.deepEqual(result.results[0], { id: "fixture-1", name: "Sapporo Station", address: "Sapporo Station, Japan",
    latitude: 43.06, longitude: 141.35, language: "en", kind: "역", area: "Sapporo Kita Ward" });
  const plain = await queryGeoapify("Sapporo", "fixture", async (url) => {
    assert.equal(new URL(url).searchParams.get("bias"), "countrycode:jp");
    return Response.json({ results: [] });
  });
  assert.deepEqual(plain, { status: "ok", results: [] });
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

test("a Japanese station query without a station result asks once for stations by the bare name", async () => {
  const calls = [];
  const result = await queryGeoapify("小樽駅", "fixture", async (url) => {
    const params = new URL(url).searchParams;
    calls.push([params.get("text"), params.get("type")]);
    return Response.json({ results: params.get("type") === "amenity"
      ? [row("fixture-station", "小樽", { category: "public_transport.train" }), row("fixture-city-hall", "小樽市役所", { category: "office" })]
      : [row("fixture-post", "小樽駅前郵便局", { category: "service.post" })] });
  });
  assert.deepEqual(calls, [["小樽駅", null], ["小樽", "amenity"]]);
  assert.deepEqual(result.results.map(({ id }) => id), ["fixture-station", "fixture-post"]);
  const once = [];
  await queryGeoapify("札幌駅", "fixture", async (url) => {
    once.push(new URL(url).searchParams.get("text"));
    return Response.json({ results: [row("fixture-sapporo", "札幌駅", { category: "public_transport.train" })] });
  });
  assert.deepEqual(once, ["札幌駅"]);
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
