import { useState } from "react";
import type { ClimateInfo, OutlookTown } from "../data/api";

const VIEW_KEY = "hotter-years-view";

/**
 * Very hot days a year at each forecast town, now and around 2050: a chart (default) or a table, most added first.
 * Shared by both outlook pages.
 */
export function HotterYearsAhead({ towns, climate }: { towns: OutlookTown[]; climate: ClimateInfo }) {
  const [view, setView] = useState<"chart" | "table">(() => { try { return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "chart"; } catch { return "chart"; } });
  const choose = (v: "chart" | "table") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* a per-browser preference only */ } };
  const rows = towns.filter((t) => t.climate?.hot != null && t.climate?.hot2050 != null)
    .map((t) => ({ t, now: t.climate!.hot!, then: t.climate!.hot2050!, added: t.climate!.hot2050! - t.climate!.hot! }))
    .sort((a, b) => b.added - a.added);
  const max = Math.max(1, ...rows.map((r) => r.then));
  const r0 = (n: number) => Math.round(n);

  return (
    <section className="panel" aria-labelledby="future-title">
      <div className="panel-head">
        <h2 id="future-title">Hotter years ahead</h2>
        <span className="view-switch" role="group" aria-label="Show as">
          <button type="button" aria-pressed={view === "chart"} onClick={() => choose("chart")}>Chart</button>
          <button type="button" aria-pressed={view === "table"} onClick={() => choose("table")}>Table</button>
        </span>
      </div>
      <p className="hint future-head">Days a year at {climate.thresholds.hot}°C or more: now ({climate.baselineYears[0]}–{climate.baselineYears[1]}) and around 2050 ({climate.period}, {climate.scenario}), most added first.</p>

      {view === "chart" ? (
        <div className="future-chart">
          <p className="future-key" aria-hidden="true"><span><i className="fk-now" />Now</span><span><i className="fk-added" />Added by around 2050</span></p>
          <ul className="plain future-bars" aria-label={`Days a year at ${climate.thresholds.hot}°C or more, now and around 2050, by town`}>
            {rows.map(({ t, now, then, added }) => (
              <li key={t.id} title={`${t.name}: ${r0(now)} days now, about ${r0(then)} around 2050 (+${r0(added)}); ${t.customers} customers`}>
                <span className="fb-town"><strong>{t.name}</strong><span className="sub">{t.customers} customer{t.customers === 1 ? "" : "s"}</span></span>
                <span className="fb-track" aria-hidden="true">
                  <i className="fb-now" style={{ width: `${(now / max) * 100}%` }} />
                  <i className="fb-added" style={{ width: `${(Math.max(0, added) / max) * 100}%` }} />
                </span>
                <span className="fb-nums"><strong>{r0(now)} → {r0(then)}</strong><span className="future-add">+{r0(added)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="town-table future-table">
            <thead>
              <tr><th scope="col" rowSpan={2}>Town</th><th scope="col" rowSpan={2} className="t-num">Customers</th><th scope="colgroup" colSpan={3} className="t-group">{climate.thresholds.hot}°C or more</th><th scope="colgroup" colSpan={3} className="t-group">{climate.thresholds.veryHot}°C or more</th></tr>
              <tr>{[0, 1].map((g) => ["Now", "~2050", "Added"].map((h) => <th key={`${g}${h}`} scope="col" className={`t-num${g === 1 && h === "Now" ? " t-split" : ""}`}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {rows.map(({ t, now, then, added }) => (
                <tr key={t.id}>
                  <th scope="row"><span className="town-name">{t.name}</span><span className="sub">{t.districtName}</span></th>
                  <td className="t-num">{t.customers}</td>
                  <td className="t-num">{r0(now)}</td>
                  <td className="t-num"><strong>{r0(then)}</strong></td>
                  <td className="t-num future-add">+{r0(added)}</td>
                  <td className="t-num t-split">{r0(t.climate!.veryHot ?? 0)}</td>
                  <td className="t-num"><strong>{r0(t.climate!.veryHot2050 ?? 0)}</strong></td>
                  <td className="t-num future-add">+{r0(Math.max(0, (t.climate!.veryHot2050 ?? 0) - (t.climate!.veryHot ?? 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint future-note">Now: SILO (Queensland Government, from Bureau of Meteorology observations). Around 2050: the median of three CMIP6 climate models from Climate Change in Australia (CSIRO, Bureau of Meteorology, Australian Climate Service), on a middle emissions path. Both CC BY 4.0. A guide to long-term exposure for planning, not a forecast.</p>
    </section>
  );
}
