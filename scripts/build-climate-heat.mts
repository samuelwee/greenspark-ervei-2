// Builds the long-term heat table for each postcode in the dataset: how many very hot days a year it usually gets,
// and how many it is projected to get around 2050.
//
//   SILO_EMAIL=you@example.com npx tsx scripts/build-climate-heat.mts
//
// Baseline: SILO daily maximum temperature (Queensland Government, from Bureau of Meteorology observations,
// CC BY 4.0) at each postcode's location, 1995 to 2024. SILO asks for an email address with every request; it is
// read from SILO_EMAIL and never written to the output.
//
// Projection: the CMIP6 application-ready daily data from Climate Change in Australia (CSIRO, Bureau of Meteorology
// and the Australian Climate Service, CC BY 4.0), scaled to the AGCD observations on a 5 km grid. For each forecast
// town, the change in hot days is the models' 2035-2064 count under SSP2-4.5 (a middle emissions path) minus the
// AGCD 1985-2014 count, and is added to the SILO baseline of each postcode in that town. The server answers one
// point and one year per request and is slow, so it uses every third year and three models that span the range.
//
// Writes data/climate/heat-by-postcode.v1.json. The numbers are a guide to long-term exposure, not a forecast.
import { mkdirSync, writeFileSync } from "node:fs";
import { POSTCODE_LOCATION, POSTCODE_TOWN } from "../shared/src/index";

const EMAIL = process.env.SILO_EMAIL;
if (!EMAIL) throw new Error("Set SILO_EMAIL: SILO asks for an email address with each request.");
const OUT = "data/climate/heat-by-postcode.v1.json";
const HOT = 35, VERY_HOT = 40;
const SILO_YEARS = [1995, 2024] as const;
const MODELS = ["ACCESS-CM2", "EC-Earth3", "NorESM2-MM"];
const MEMBER: Record<string, string> = { "ACCESS-CM2": "r4i1p1f1", "EC-Earth3": "r1i1p1f1", "NorESM2-MM": "r1i1p1f1" };
const BASE_YEARS = range(1985, 2014, 3), FUTURE_YEARS = range(2035, 2064, 3);
const THREDDS = "https://data-cbr.csiro.au/thredds";
const ROOT = "catch_all/qdc-cmip6/ssp-data/AGCD";

function range(a: number, b: number, step: number) { const out: number[] = []; for (let y = a; y <= b; y += step) out.push(y); return out; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function text(url: string, tries = 4): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e instanceof Error ? e.message : e}`);
      await sleep(2000 * i);
    }
  }
}
/** Runs the jobs a few at a time, so the data servers aren't flooded. */
async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
      if (++done % 25 === 0) console.log(`  ${done}/${jobs.length}`);
    }
  }));
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** SILO: days a year at or above 35°C and 40°C, and the average summer (Dec to Feb) maximum, at one point. */
async function siloBaseline([lat, lng]: [number, number]) {
  const url = `https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}&start=${SILO_YEARS[0]}0101&finish=${SILO_YEARS[1]}1231&format=csv&comment=X&username=${encodeURIComponent(EMAIL!)}&password=apirequest`;
  const rows = (await text(url)).trim().split("\n").slice(1).map((l) => l.split(",")).map((c) => ({ date: c[2]!.trim(), max: Number(c[3]) })).filter((r) => Number.isFinite(r.max));
  const years = SILO_YEARS[1] - SILO_YEARS[0] + 1;
  const summer = rows.filter((r) => ["12", "01", "02"].includes(r.date.slice(5, 7))).map((r) => r.max);
  return { hot: round1(rows.filter((r) => r.max >= HOT).length / years), veryHot: round1(rows.filter((r) => r.max >= VERY_HOT).length / years), summerMax: round1(mean(summer)) };
}

/** One year's daily maxima at one point from a CMIP6 (or AGCD) file: days at or above 35°C and 40°C. */
async function yearCounts(path: string, [lat, lng]: [number, number]) {
  const csv = await text(`${THREDDS}/ncss/grid/${path}?var=tasmax&latitude=${lat}&longitude=${lng}&temporal=all&accept=csv`);
  const vals = csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[3])).filter(Number.isFinite);
  return { hot: vals.filter((v) => v >= HOT).length, veryHot: vals.filter((v) => v >= VERY_HOT).length };
}
const obsFile = (y: number) => `${ROOT}/obs/historical/v-csiro/day/tasmax/AUS-05/1985-2014/v20241104/tasmax_day_AGCD_historical_v-csiro_AUS-05_${y}.nc`;
const modelFile = (m: string, y: number) =>
  `${ROOT}/${m}/ssp245/${MEMBER[m]}/day/tasmax/AUS-05/2035-2064/v20241104/tasmax_day_${m}_ssp245_${MEMBER[m]}_AUS-05_${y}_qdc-additive-monthly-q100-linear_AGCD-baseline-1985-2014_model-baseline-1985-2014.nc`;

async function main() {
  const postcodes = Object.keys(POSTCODE_LOCATION).sort();
  console.log(`SILO baseline for ${postcodes.length} postcodes…`);
  const silo = await pool(postcodes.map((pc) => () => siloBaseline(POSTCODE_LOCATION[pc]!)), 4);

  // Each forecast town sits at the average of its postcodes, as on the outlook map.
  const towns = [...new Set(Object.values(POSTCODE_TOWN))].map((id) => {
    const pts = Object.entries(POSTCODE_TOWN).filter(([, t]) => t === id).flatMap(([pc]) => (POSTCODE_LOCATION[pc] ? [POSTCODE_LOCATION[pc]!] : []));
    return { id, at: [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1]))] as [number, number] };
  }).filter((t) => Number.isFinite(t.at[0]));
  console.log(`CMIP6 change for ${towns.length} towns: AGCD ${BASE_YEARS.length} years + ${MODELS.length} models × ${FUTURE_YEARS.length} years…`);
  const change: Record<string, { hot: number; veryHot: number; models: Record<string, { hot: number; veryHot: number }> }> = {};
  for (const t of towns) {
    const obs = await pool(BASE_YEARS.map((y) => () => yearCounts(obsFile(y), t.at)), 6);
    const base = { hot: mean(obs.map((o) => o.hot)), veryHot: mean(obs.map((o) => o.veryHot)) };
    const models: Record<string, { hot: number; veryHot: number }> = {};
    for (const m of MODELS) {
      const fut = await pool(FUTURE_YEARS.map((y) => () => yearCounts(modelFile(m, y), t.at)), 6);
      models[m] = { hot: round1(mean(fut.map((o) => o.hot)) - base.hot), veryHot: round1(mean(fut.map((o) => o.veryHot)) - base.veryHot) };
    }
    change[t.id] = { hot: round1(median(Object.values(models).map((v) => v.hot))), veryHot: round1(median(Object.values(models).map((v) => v.veryHot))), models };
    console.log(`  ${t.id}: +${change[t.id]!.hot} days ≥${HOT}°C (${MODELS.map((m) => models[m]!.hot).join(", ")})`);
  }

  const byPostcode = Object.fromEntries(postcodes.map((pc, i) => {
    const b = silo[i]!, c = POSTCODE_TOWN[pc] ? change[POSTCODE_TOWN[pc]!] : undefined;
    return [pc, { ...b, hot2050: c ? round1(Math.max(0, b.hot + c.hot)) : null, veryHot2050: c ? round1(Math.max(0, b.veryHot + c.veryHot)) : null, town: POSTCODE_TOWN[pc] ?? null }];
  }));
  mkdirSync("data/climate", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    id: "climate-heat.v1", builtAt: new Date().toISOString(),
    thresholds: { hot: HOT, veryHot: VERY_HOT },
    baseline: { source: "SILO daily maximum temperature (Queensland Government), from Bureau of Meteorology observations", years: SILO_YEARS, licence: "CC BY 4.0" },
    projection: {
      source: "CMIP6 application-ready daily data, Climate Change in Australia (CSIRO, Bureau of Meteorology, Australian Climate Service)",
      scenario: "SSP2-4.5", period: "2035-2064", baselinePeriod: "1985-2014 (AGCD)", models: MODELS, sampledYears: { baseline: BASE_YEARS, future: FUTURE_YEARS },
      method: "Median across models of the change in days a year at the forecast town, added to each postcode's SILO baseline", licence: "CC BY 4.0",
    },
    towns: change, postcodes: byPostcode,
  }, null, 1) + "\n");
  console.log(`Wrote ${OUT}`);
}
await main();
