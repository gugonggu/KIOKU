import assert from "node:assert/strict";
import test from "node:test";
import { mapHref } from "../src/app/trips/[tripId]/map/links.ts";
import { directionsUrl, filterPlaces, parseGoogleMapsCoordinates, parsePlace, searchPlaces } from "../src/lib/trip-places.ts";
import { queryGeoapify, normalizeQuery, searchLanguage } from "../src/lib/geoapify.ts";

function form(fields) {
  const data = new FormData();
  for (const [key,value] of Object.entries(fields)) data.set(key,value);
  return data;
}

test("manual names, multilingual fields, coordinates and directions", () => {
  const manual = parsePlace(form({ display_name: "  Sapporo place  ", name_ja: "札幌", notes: "Private", address_text:"Sapporo" }));
  assert.equal(manual.provider, "MANUAL");
  assert.equal(manual.display_name, "Sapporo place");
  assert.equal(manual.name_ja, "札幌");
  assert.equal(directionsUrl(parsePlace(form({ display_name: "Name only" }))), null);
  assert.equal(directionsUrl(parsePlace(form({ display_name: "Ambiguous", address_text:"?" }))), null);
  for (const fields of [{ latitude:"91", longitude:"140" }, { longitude:"0" }, { latitude:"NaN", longitude:"140" }])
    assert.equal(typeof parsePlace(form({ display_name:"Sapporo", ...fields })), "string");
  const coordinates = parsePlace(form({ display_name:"Zero", latitude:"0", longitude:"0", notes:"Private" }));
  assert.deepEqual(Object.fromEntries(new URL(directionsUrl(coordinates)).searchParams), { api:"1", destination:"0,0" });
  assert.equal(new URL(directionsUrl(manual)).searchParams.get("destination"), "Sapporo");
  assert.equal(typeof parsePlace(form({ display_name:"Invalid", provider:"GEOAPIFY", provider_place_id:"x" })), "string");
});

test("map date and candidate filters have distinct scope", () => {
  const places = ["a","b","c","d"].map((id) => ({ id }));
  const links = [{ place_id:"a",local_date:"2027-02-19" },{ place_id:"a",local_date:"2027-02-20" },{ place_id:"b",local_date:null }, { place_id:"d",local_date:"2027-02-20" }];
  assert.deepEqual(filterPlaces(places, links, "date", "2027-02-19"), [{ id:"a" }]);
  assert.deepEqual(filterPlaces(places, links, "candidates", null), [{ id:"b" },{ id:"c" }]);
});

test("saved place search matches localized names and addresses without broadening the active filter", () => {
  const station = { id: "a", display_name: "삿포로역", name_ja: "札幌駅", name_en: "Sapporo Station", address_text: "北海道" };
  const food = { id: "b", display_name: "오타루 식당", name_ja: "小樽", address_text: "北海道" };
  const scoped = filterPlaces([station, food], [{ place_id: "a", local_date: "2027-02-19" }], "date", "2027-02-19");
  assert.deepEqual(searchPlaces(scoped, " ＳＡＰＰＯＲＯ  station "), [station]);
  assert.deepEqual(searchPlaces(scoped, "札幌"), [station]);
  assert.deepEqual(searchPlaces(scoped, "北海道"), [station]);
  assert.deepEqual(searchPlaces(scoped, "小樽"), []);
  assert.deepEqual(filterPlaces([{ id: "a", latitude: 0, longitude: 0 }, { id: "b", latitude: null, longitude: null }], [], "unlocated", null).map(({ id }) => id), ["b"]);
});

test("Google Maps links yield only explicit coordinate pairs and never use a viewport center", () => {
  assert.deepEqual(parseGoogleMapsCoordinates("https://www.google.com/maps/search/?api=1&query=43.06%2C141.35"), [141.35, 43.06]);
  assert.deepEqual(parseGoogleMapsCoordinates("https://maps.google.co.jp/maps?q=43%2C+141"), [141, 43]);
  for (const link of [
    "https://www.google.com/maps/place/Sapporo/@43,141,15z",
    "https://www.google.com/maps/search/?query=43,141&query_place_id=ChIJ123",
    "https://www.google.com/maps/search/?query=95,181",
    "https://www.google.com/maps/search/?query=43,141&query=44,142",
    "https://maps.app.goo.gl/example",
    "https://www.google.com.example/maps?q=43,141",
    "http://www.google.com/maps?q=43,141",
  ]) assert.equal(parseGoogleMapsCoordinates(link), null, link);
});

test("map links preserve filter, view and search alongside editor and route state", () => {
  const href = mapHref("trip-fixture", { date: "2027-02-19", filter: "date", view: "map", place: "place-fixture", mode: "edit", query: "삿포로 역", route: true });
  const { pathname, searchParams } = new URL(href, "https://example.test");
  assert.equal(pathname, "/trips/trip-fixture/map");
  assert.deepEqual(Object.fromEntries(searchParams), {
    date: "2027-02-19", filter: "date", place: "place-fixture", mode: "edit", view: "map", q: "삿포로 역", route: "1",
  });
  assert.equal(mapHref("trip-fixture", { view: "list", place: "place-fixture" }), "/trips/trip-fixture/map?place=place-fixture&view=list");
});

test("Geoapify requests use a Japan filter and a fixed endpoint and validate external rows", async () => {
  assert.equal(normalizeQuery("   A   "), null);
  assert.equal(normalizeQuery("  Sapporo    station  "), "Sapporo station");
  assert.deepEqual(["삿포로", "札幌", "Sapporo"].map(searchLanguage), ["ko","ja","en"]);
  const valid = { country_code:"jp", place_id:"fixture-1", name:"Sapporo", formatted:"Hokkaido, Japan", lat:43, lon:141 };
  const result = await queryGeoapify("Sapporo", "fake-test-key", async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.geoapify.com");
    assert.equal(new URL(url).searchParams.get("filter"), "countrycode:jp");
    assert.equal(new URL(url).searchParams.get("limit"), "5");
    assert.ok(options.signal);
    return Response.json({ results:[valid, valid, { ...valid, place_id:"bad",lat:91 }, { ...valid, country_code:"us" }] });
  });
  assert.deepEqual(result, { status:"ok", results:[{ id:"fixture-1",name:"Sapporo",address:"Hokkaido, Japan",latitude:43,longitude:141,language:"en" }] });
  assert.equal((await queryGeoapify("Sapporo","fake",async () => new Response(null,{ status:429 }))).status,"limited");
  assert.equal((await queryGeoapify("Sapporo","fake",async () => { throw new Error("network"); })).status,"unavailable");
  assert.equal((await queryGeoapify("Sapporo","",async () => { throw new Error("must not call"); })).status,"unconfigured");
});
