// Builds the decade-by-decade heat table for the Climate outlook page: very hot days a year at each postcode in
// every decade, observed (1960s to 2020-25) and projected (2035-39 to the 2090s).
//
//   SILO_EMAIL=you@example.com npx tsx scripts/build-climate-decades.mts
//
// Observed: SILO daily maximum temperature (Queensland Government, from Bureau of Meteorology observations,
// CC BY 4.0) at each postcode's location. SILO asks for an email address with every request; it is read from
// SILO_EMAIL and never written to the output.
//
// Projected: Climate Change in Australia's CMIP6 application-ready daily data (CSIRO, Bureau of Meteorology and the
// Australian Climate Service, CC BY 4.0), SSP2-4.5, three models. The data only covers 2035-2064 and 2070-2099. For
// each forecast town, a decade's change is the models' median count in that decade minus the AGCD 1985-2014 count;
// it is added to each postcode's own SILO 1985-2014 count, so both sides share the same baseline years. The server
// answers one point and one year per request and is slow, so every second year is sampled.
//
// Writes data/climate/heat-decades.v1.json. A guide to long-term exposure, not a forecast.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { POSTCODE_LOCATION, POSTCODE_TOWN } from "../shared/src/index";

const EMAIL = process.env.SILO_EMAIL;
if (!EMAIL) throw new Error("Set SILO_EMAIL: SILO asks for an email address with each request.");
const OUT = "data/climate/heat-decades.v1.json";
const HOT = 35, VERY_HOT = 40;
const OBS_START = 1960, OBS_END = 2025;
// CLIMATE_MODELS (comma-separated) and CLIMATE_YEAR_STEP give a quicker first pass; the cache keeps what it fetched.
const MODELS = (process.env.CLIMATE_MODELS ?? "ACCESS-CM2,EC-Earth3,NorESM2-MM").split(",").map((m) => m.trim()).filter(Boolean);
const STEP = Number(process.env.CLIMATE_YEAR_STEP ?? 2);
const MEMBER: Record<string, string> = { "ACCESS-CM2": "r4i1p1f1", "EC-Earth3": "r1i1p1f1", "NorESM2-MM": "r1i1p1f1" };
const BASE_YEARS = range(1985, 2014, 3);
const PERIODS = [{ dir: "2035-2064", years: range(2035, 2064, STEP) }, { dir: "2070-2099", years: range(2071, 2099, STEP) }];
const THREDDS = "https://data-cbr.csiro.au/thredds";
const ROOT = "catch_all/qdc-cmip6/ssp-data/AGCD";
// The projections server slows right down when asked for many points at once, so the requests share one small pool.
const CONCURRENCY = Number(process.env.CLIMATE_CONCURRENCY ?? 6);
// Each answer is kept, so a stopped run picks up where it left off.
const CACHE = process.env.CLIMATE_CACHE ?? ".climate-cache.json";
const cache: Record<string, Counts> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
let unsaved = 0;
const save = () => { writeFileSync(CACHE, JSON.stringify(cache)); unsaved = 0; };

function range(a: number, b: number, step: number) { const out: number[] = []; for (let y = a; y <= b; y += step) out.push(y); return out; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function text(url: string, tries = 5): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e instanceof Error ? e.message : e}`);
      await sleep(3000 * i);
    }
  }
}
/** Runs the jobs a few at a time, so the data servers aren't flooded. */
async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i]!(); } }));
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const round1 = (n: number) => Math.round(n * 10) / 10;
type Counts = { hot: number; veryHot: number };

/** A decade's label: whole decades as "1990s", part decades by their years ("2020-25", "2035-39"). */
function decadeLabel(years: number[]): string {
  const d = Math.floor(years[0]! / 10) * 10, lo = Math.min(...years), hi = Math.max(...years);
  return lo === d && hi === d + 9 ? `${d}s` : `${lo}-${String(hi).slice(2)}`;
}
function byDecade(perYear: Map<number, Counts>): { decade: string; hot: number; veryHot: number }[] {
  const groups = new Map<number, number[]>();
  for (const y of perYear.keys()) { const d = Math.floor(y / 10) * 10; groups.set(d, [...(groups.get(d) ?? []), y]); }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, ys]) => ({
    decade: decadeLabel(ys), hot: mean(ys.map((y) => perYear.get(y)!.hot)), veryHot: mean(ys.map((y) => perYear.get(y)!.veryHot)),
  }));
}

/** SILO daily maxima at one point, counted per year. Only years SILO has in full count. */
async function siloYears([lat, lng]: [number, number]): Promise<Map<number, Counts>> {
  const url = `https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}&start=${OBS_START}0101&finish=${OBS_END}1231&format=csv&comment=X&username=${encodeURIComponent(EMAIL!)}&password=apirequest`;
  const out = new Map<number, Counts & { days: number }>();
  for (const line of (await text(url)).trim().split("\n").slice(1)) {
    const c = line.split(","), y = Number(c[2]!.trim().slice(0, 4)), v = Number(c[3]);
    if (!Number.isFinite(v) || !y) continue;
    const r = out.get(y) ?? { hot: 0, veryHot: 0, days: 0 };
    r.days++; if (v >= HOT) r.hot++; if (v >= VERY_HOT) r.veryHot++;
    out.set(y, r);
  }
  return new Map([...out].filter(([, r]) => r.days >= 365).map(([y, r]) => [y, { hot: r.hot, veryHot: r.veryHot }]));
}

const failed: string[] = [];
/** One year's counts at one point, or null when the server keeps refusing that file: the year is then left out. */
async function yearCounts(path: string, [lat, lng]: [number, number]): Promise<Counts | null> {
  const key = `${path}@${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache[key]) return cache[key]!;
  let csv: string;
  try { csv = await text(`${THREDDS}/ncss/grid/${path}?var=tasmax&latitude=${lat}&longitude=${lng}&temporal=all&accept=csv`); }
  catch (e) { failed.push(key); console.log(`  skipped ${key}: ${e instanceof Error ? e.message.slice(-40) : e}`); return null; }
  const vals = csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[3])).filter(Number.isFinite);
  const counts = { hot: vals.filter((v) => v >= HOT).length, veryHot: vals.filter((v) => v >= VERY_HOT).length };
  cache[key] = counts;
  if (++unsaved >= 10) save();
  return counts;
}
const obsFile = (y: number) => `${ROOT}/obs/historical/v-csiro/day/tasmax/AUS-05/1985-2014/v20241104/tasmax_day_AGCD_historical_v-csiro_AUS-05_${y}.nc`;
const modelFile = (m: string, dir: string, y: number) =>
  `${ROOT}/${m}/ssp245/${MEMBER[m]}/day/tasmax/AUS-05/${dir}/v20241104/tasmax_day_${m}_ssp245_${MEMBER[m]}_AUS-05_${y}_qdc-additive-monthly-q100-linear_AGCD-baseline-1985-2014_model-baseline-1985-2014.nc`;

async function main() {
  const postcodes = Object.keys(POSTCODE_LOCATION).sort();
  console.log(`SILO ${OBS_START}-${OBS_END} for ${postcodes.length} postcodes…`);
  const silo = await pool(postcodes.map((pc) => () => siloYears(POSTCODE_LOCATION[pc]!)), 4);

  const towns = [...new Set(Object.values(POSTCODE_TOWN))].map((id) => {
    const pts = Object.entries(POSTCODE_TOWN).filter(([, t]) => t === id).flatMap(([pc]) => (POSTCODE_LOCATION[pc] ? [POSTCODE_LOCATION[pc]!] : []));
    return { id, at: [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1]))] as [number, number] };
  });
  const futureYears = PERIODS.flatMap((p) => p.years.map((y) => ({ dir: p.dir, y })));
  console.log(`CMIP6 for ${towns.length} towns: AGCD ${BASE_YEARS.length} years + ${MODELS.length} models × ${futureYears.length} years…`);
  // Every request for every town, model and year goes through one pool, then is grouped back by town.
  const jobs = towns.flatMap((t) => [
    ...BASE_YEARS.map((y) => ({ t: t.id, m: "obs", y, run: () => yearCounts(obsFile(y), t.at) })),
    ...MODELS.flatMap((m) => futureYears.map(({ dir, y }) => ({ t: t.id, m, y, run: () => yearCounts(modelFile(m, dir, y), t.at) }))),
  ]);
  let done = 0;
  const results = await pool(jobs.map((j) => async () => { const r = await j.run(); if (++done % 50 === 0) console.log(`  ${done}/${jobs.length}`); return r; }), CONCURRENCY);
  save();
  if (failed.length) console.log(`Left out ${failed.length} year(s) the server would not serve.`);
  const change: Record<string, Record<string, Counts>> = {};
  for (const t of towns) {
    const of = (m: string) => jobs.map((j, i) => ({ j, r: results[i]! })).filter(({ j }) => j.t === t.id && j.m === m);
    const obs = of("obs").flatMap(({ r }) => (r ? [r] : []));
    const base = { hot: mean(obs.map((o) => o.hot)), veryHot: mean(obs.map((o) => o.veryHot)) };
    const perModel = MODELS.map((m) => byDecade(new Map(of(m).flatMap(({ j, r }) => (r ? [[j.y, r] as const] : [])))));
    change[t.id] = Object.fromEntries(perModel[0]!.map((d, i) => [d.decade, {
      hot: round1(median(perModel.map((pm) => pm[i]!.hot)) - base.hot), veryHot: round1(median(perModel.map((pm) => pm[i]!.veryHot)) - base.veryHot),
    }]));
    console.log(`  ${t.id}: ${Object.entries(change[t.id]!).map(([d, c]) => `${d} +${c.hot}`).join(", ")}`);
  }

  const observedDecades = byDecade(silo[0]!).map((d) => d.decade);
  const projectedDecades = Object.keys(change[towns[0]!.id]!);
  const byPostcode = Object.fromEntries(postcodes.map((pc, i) => {
    const years = silo[i]!;
    const base = [...years].filter(([y]) => y >= 1985 && y <= 2014).map(([, c]) => c);
    const b = { hot: mean(base.map((c) => c.hot)), veryHot: mean(base.map((c) => c.veryHot)) };
    const town = POSTCODE_TOWN[pc] ?? null;
    return [pc, {
      town,
      observed: Object.fromEntries(byDecade(years).map((d) => [d.decade, { hot: round1(d.hot), veryHot: round1(d.veryHot) }])),
      projected: town ? Object.fromEntries(projectedDecades.map((d) => [d, { hot: round1(Math.max(0, b.hot + change[town]![d]!.hot)), veryHot: round1(Math.max(0, b.veryHot + change[town]![d]!.veryHot)) }])) : {},
    }];
  }));
  mkdirSync("data/climate", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    id: "climate-decades.v1", builtAt: new Date().toISOString(), thresholds: { hot: HOT, veryHot: VERY_HOT },
    observedDecades, projectedDecades,
    observed: { source: "SILO daily maximum temperature (Queensland Government), from Bureau of Meteorology observations", years: [OBS_START, OBS_END], licence: "CC BY 4.0" },
    projected: {
      source: "CMIP6 application-ready daily data, Climate Change in Australia (CSIRO, Bureau of Meteorology, Australian Climate Service)",
      scenario: "SSP2-4.5", models: MODELS, coverage: "2035-2064 and 2070-2099", sampled: STEP === 1 ? "every year" : STEP === 2 ? "every second year" : STEP === 3 ? "every third year" : `every ${STEP}th year`,
      method: "Each postcode's SILO 1985-2014 count plus the median change across models at its forecast town, against AGCD 1985-2014", licence: "CC BY 4.0",
    },
    postcodes: byPostcode,
  }, null, 1) + "\n");
  console.log(`Wrote ${OUT}`);
}
await main();
