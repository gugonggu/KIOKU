import assert from "node:assert/strict";
import test from "node:test";
import { directionsUrl, filterPlaces, parsePlace } from "../src/lib/trip-places.ts";
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
