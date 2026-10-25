// Convert BoM IDM00001's public district shapefile to a compact WA-only display layer.
// Download/extract ftp://ftp.bom.gov.au/anon/home/adfd/spatial/IDM00001.zip first.
// Usage: node scripts/convert-forecast-districts.mjs <extracted directory>
// These are broad warning districts, not heatwave-intensity contours. GDA94 is adequate for this overview.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory containing IDM00001.shp and .dbf");
const dbf = readFileSync(join(directory, "IDM00001.dbf"));
const shp = readFileSync(join(directory, "IDM00001.shp"));
const header = dbf.readUInt16LE(8), length = dbf.readUInt16LE(10), fields = [];
for (let p = 32; p < header - 1 && dbf[p] !== 13; p += 32) fields.push({ name: dbf.toString("ascii", p, p + 11).replace(/\0.*/, ""), length: dbf[p + 16] });
const records = [];
for (let p = header; p + length <= dbf.length; p += length) {
  const record = {}; let offset = p + 1;
  for (const f of fields) { record[f.name] = dbf.toString("utf8", offset, offset + f.length).trim(); offset += f.length; }
  records.push(record);
}

const distance = (p, a, b) => {
  const x = b[0] - a[0], y = b[1] - a[1];
  const t = x || y ? Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y))) : 0;
  return (p[0] - a[0] - t * x) ** 2 + (p[1] - a[1] - t * y) ** 2;
};
function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0.005 ** 2, at = -1;
    for (let i = a + 1; i < b; i++) { const d = distance(points[i], points[a], points[b]); if (d > best) { best = d; at = i; } }
    if (at !== -1) { keep.add(at); stack.push([a, at], [at, b]); }
  }
  const reduced = [...keep].sort((a, b) => a - b).map((i) => points[i]);
  return reduced.length >= 4 ? reduced : points.slice(0, 3).concat([points[0]]);
}
const area = (ring) => ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
const inside = (p, ring) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
};
const features = [];
let recordIndex = 0;
for (let offset = 100; offset < shp.length; recordIndex++) {
  const size = shp.readInt32BE(offset + 4) * 2, start = offset + 8;
  offset = start + size;
  const attributes = records[recordIndex];
  if (!attributes?.AAC?.startsWith("WA_PW") || shp.readInt32LE(start) !== 5) continue;
  const partCount = shp.readInt32LE(start + 36), pointCount = shp.readInt32LE(start + 40);
  const starts = Array.from({ length: partCount }, (_, i) => shp.readInt32LE(start + 44 + i * 4)).concat(pointCount);
  const pointStart = start + 44 + partCount * 4;
  const rings = starts.slice(0, -1).map((from, i) => {
    const points = [];
    for (let j = from; j < starts[i + 1]; j++) points.push([+shp.readDoubleLE(pointStart + j * 16).toFixed(4), +shp.readDoubleLE(pointStart + j * 16 + 8).toFixed(4)]);
    return simplify(points);
  }).filter((ring) => ring.length >= 4);
  const polygons = rings.filter((ring) => area(ring) < 0).map((ring) => [ring]);
  for (const hole of rings.filter((ring) => area(ring) >= 0)) { const polygon = polygons.find((p) => inside(hole[0], p[0])); if (polygon) polygon.push(hole); }
  features.push({ type: "Feature", properties: { id: attributes.AAC, name: attributes.DIST_NAME }, geometry: { type: "MultiPolygon", coordinates: polygons } });
}
if (features.length !== 14 || features.some((f) => !f.geometry.coordinates.length)) throw new Error("Expected 14 non-empty WA forecast districts");
const output = new URL("../web/src/data/forecastDistricts.json", import.meta.url);
writeFileSync(output, JSON.stringify({ type: "FeatureCollection", source: "Australian Government Bureau of Meteorology, IDM00001, public forecast districts; downloaded 25 Oct 2026; simplified for display", features }) + "\n");
console.log(`Wrote ${features.length} districts (${features.map((f) => f.properties.name).join(", ")})`);
