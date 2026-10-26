import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ApiClient, ClimateDecades } from "../data/api";

// Leaflet only loads with this page.
const ClimateIncreaseMap = lazy(() => import("./ClimateIncreaseMap").then((m) => ({ default: m.ClimateIncreaseMap })));

/** Background and text colour for a count of very hot days a year: pale to deep red. */
function daysColor(n: number | null, max: number): { background: string; color: string } {
  if (n === null) return { background: "#f1f2f4", color: "#5e6c84" };
  const t = Math.min(1, n / Math.max(1, max));
  const steps: [number, string, string][] = [[0.75, "#ae2e24", "#fff"], [0.5, "#e2683c", "#fff"], [0.3, "#f29d52", "#3d1d00"], [0.15, "#f8c88a", "#3d2400"], [0.05, "#fbe6c2", "#3d2a00"]];
  const s = steps.find(([at]) => t >= at);
  return s ? { background: s[1], color: s[2] } : { background: "#fff8ee", color: "#253858" };
}

/**
 * The long view: how many hot days a year each forecast town gets, decade by decade
 * from the 1960s to the 2090s, observed then projected.
 */
export function ClimateOutlookPage({ client }: { client: Pick<ApiClient, "climateDecades"> }) {
  const [decades, setDecades] = useState<ClimateDecades | null>(null);
  const [threshold, setThreshold] = useState<"hot" | "veryHot">("hot");
  const [error, setError] = useState<string | null>(null);
  // A town picked on the map or in the table, and where it was picked, so only a map click scrolls the table.
  const [selected, setSelected] = useState<{ id: string; from: "map" | "table" } | null>(null);
  const pick = (id: string, from: "map" | "table") => {
    setSelected({ id, from });
    if (from === "map") requestAnimationFrame(() => document.getElementById(`decade-row-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  useEffect(() => { document.title = "Climate outlook · ERVEI"; }, []);
  useEffect(() => {
    let live = true;
    client.climateDecades?.().then((d) => { if (live) setDecades(d); }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the climate data."); });
    return () => { live = false; };
  }, [client]);

  const d = decades?.available ? decades : null;
  // A town's increase: days a year in the last projected decade, minus the latest observed decade. Biggest first.
  const lastObserved = d?.observedDecades.at(-1), lastProjected = d?.projectedDecades.at(-1);
  const towns = useMemo(() => {
    if (!d || !lastObserved || !lastProjected) return [];
    return d.towns.map((t) => {
      const now = t.observed[lastObserved]?.[threshold] ?? null, then = t.projected[lastProjected]?.[threshold] ?? null;
      return { t, increase: now === null || then === null ? null : then - now };
    }).sort((a, b) => (b.increase ?? -Infinity) - (a.increase ?? -Infinity) || b.t.customers - a.t.customers || a.t.name.localeCompare(b.t.name));
  }, [d, threshold, lastObserved, lastProjected]);
  const max = useMemo(() => Math.max(1, ...towns.flatMap(({ t }) => [...Object.values(t.observed), ...Object.values(t.projected)].map((v) => v[threshold] ?? 0))), [towns, threshold]);

  return (
    <main id="queue" className="outlook climate-page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Climate outlook · the long view</p>
          <h1>How much hotter it’s getting</h1>
          <p className="hint">Very hot days a year where our customers live: observed since the 1960s, and projected to the 2090s on a middle emissions path. For planning where support will matter most over the coming decades.</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="decades-title">
        <div className="panel-head">
          <h2 id="decades-title">Decade by decade</h2>
          {d ? (
            <span className="view-switch" role="group" aria-label="Count days at">
              <button type="button" aria-pressed={threshold === "hot"} onClick={() => setThreshold("hot")}>{d.thresholds.hot}°C or more</button>
              <button type="button" aria-pressed={threshold === "veryHot"} onClick={() => setThreshold("veryHot")}>{d.thresholds.veryHot}°C or more</button>
            </span>
          ) : null}
        </div>
        {error ? <p className="muted decades-note" role="alert">{error}</p> : !decades ? <p className="muted decades-note" role="status">Loading…</p> : !d ? <p className="muted decades-note">The decade-by-decade data isn’t on this server yet.</p> : (
          <>
            <p className="hint decades-note">Average days a year at {d.thresholds[threshold]}°C or more in each decade, by forecast town, biggest increase first. The increase is the {lastProjected?.replace("-", "–")} count minus the {lastObserved?.replace("-", "–")} count. Part decades are shown by their years. The models don’t cover 2026 to 2034 or 2065 to 2069.</p>
            <Suspense fallback={<p className="muted decades-note" role="status">Loading the map…</p>}><ClimateIncreaseMap data={d} threshold={threshold} selected={selected} onSelect={pick} /></Suspense>
            <div className="table-wrap">
              <table className="town-table decades-table">
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>Town</th><th scope="col" rowSpan={2} className="t-num">Customers</th><th scope="col" rowSpan={2} className="t-num">Increase</th>
                    <th scope="colgroup" colSpan={d.observedDecades.length} className="t-group">Observed (SILO)</th>
                    <th scope="colgroup" colSpan={d.projectedDecades.length} className="t-group t-split">Projected ({d.projectedSource.scenario})</th>
                  </tr>
                  <tr>
                    {d.observedDecades.map((dec) => <th key={dec} scope="col" className="t-num">{dec.replace("-", "–")}</th>)}
                    {d.projectedDecades.map((dec, i) => <th key={dec} scope="col" className={`t-num${i === 0 ? " t-split" : ""}`}>{dec.replace("-", "–")}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {towns.map(({ t, increase }) => (
                    <tr key={t.id} id={`decade-row-${t.id}`} className={selected?.id === t.id ? "is-selected" : undefined} onClick={() => pick(t.id, "table")}>
                      <th scope="row"><span className="town-name">{t.name}</span>{t.district ? <span className="sub">{t.district}</span> : null}</th>
                      <td className="t-num">{t.customers}</td>
                      <td className="t-num"><span className="future-add">{increase === null ? "–" : `${increase >= 0 ? "+" : "−"}${Math.abs(Math.round(increase))}`}</span></td>
                      {d.observedDecades.map((dec) => { const v = t.observed[dec]?.[threshold] ?? null; return <td key={dec} className="t-num t-heat" style={daysColor(v, max)}>{v === null ? "–" : Math.round(v)}</td>; })}
                      {d.projectedDecades.map((dec, i) => { const v = t.projected[dec]?.[threshold] ?? null; return <td key={dec} className={`t-num t-heat t-proj${i === 0 ? " t-split" : ""}`} style={daysColor(v, max)}>{v === null ? "–" : Math.round(v)}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint decades-note">
              Observed: SILO (Queensland Government), from Bureau of Meteorology observations; early remote readings lean more on interpolation.
              Projected: {d.projectedSource.models.length === 1 ? `one CMIP6 model (${d.projectedSource.models[0]})` : `the median of ${d.projectedSource.models.length} CMIP6 models (${d.projectedSource.models.join(", ")})`} from Climate Change in Australia (CSIRO, Bureau of Meteorology, Australian Climate Service),
              as the change from 1985–2014 added to each place’s own 1985–2014 count, sampling {d.projectedSource.sampled}. Both CC BY 4.0. A guide for planning, not a forecast for any year.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
