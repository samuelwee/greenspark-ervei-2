// Fetches the boundary of each postcode in the SEIFA table, for the area map.
//
//   npx tsx scripts/build-postcode-boundaries.mts
//
// Source: ABS Australian Statistical Geography Standard (ASGS) Edition 3, Postal Areas (POA) 2021, from the ABS's
// public ArcGIS service. CC BY 4.0, (c) Commonwealth of Australia. Postal areas approximate postcodes, and are
// simplified here (about 500 m) to keep the file small.
//
// Writes web/src/data/postcode-boundaries.v1.json: a GeoJSON FeatureCollection, one feature per postcode.
import { mkdirSync, writeFileSync } from "node:fs";
import { IRSD } from "../shared/src/index";

const SERVICE = "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query";
const OUT = "web/src/data/postcode-boundaries.v1.json";
const postcodes = Object.keys(IRSD);

const body = new URLSearchParams({
  where: `poa_code_2021 IN (${postcodes.map((p) => `'${p}'`).join(",")})`,
  outFields: "poa_code_2021",
  outSR: "4326",
  maxAllowableOffset: "0.005",
  geometryPrecision: "4",
  f: "geojson",
});
const res = await fetch(SERVICE, { method: "POST", body, signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const json = await res.json() as { features?: { properties: { poa_code_2021: string }; geometry: unknown }[]; error?: { message: string } };
if (!json.features) throw new Error(json.error?.message ?? "No features returned");

const features = json.features.map((f) => ({ type: "Feature", properties: { postcode: f.properties.poa_code_2021 }, geometry: f.geometry }));
const found = new Set(features.map((f) => f.properties.postcode));
const missing = postcodes.filter((p) => !found.has(p));
mkdirSync("web/src/data", { recursive: true });
writeFileSync(OUT, JSON.stringify({
  type: "FeatureCollection",
  source: "ABS ASGS Edition 3, Postal Areas 2021 (simplified), CC BY 4.0",
  builtAt: new Date().toISOString(),
  features,
}));
console.log(`${features.length} of ${postcodes.length} postcodes written to ${OUT}${missing.length ? `; no boundary for ${missing.join(", ")}` : ""}`);
