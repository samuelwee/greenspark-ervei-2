import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ApiClient, CaseItem, EmergencyFeed } from "../data/api";
import { readableDates } from "../domain/format";
import { HAZARD_ICON, alertColor, dayDate, dayName, isWarning, km, tempColor } from "./outlookText";

// Leaflet only loads when a case has somewhere to show.
const CaseWeatherMap = lazy(() => import("./CaseWeatherMap").then((m) => ({ default: m.CaseWeatherMap })));
/** Warnings this close to the suburb (to its centre or any point of its area) are shown. */
const NEAR_KM = 150;
/** The outlook's symbols for the three weather signals. */
const SIGNAL_ICON: Record<string, string> = { wx_extreme_heat: HAZARD_ICON.heat, wx_fire_danger: HAZARD_ICON.fire, wx_warning: HAZARD_ICON.warning };

/** The customer's week of weather: the Bureau's forecast for their area, its weather signals, and Emergency WA warnings nearby. */
export function CaseWeather({ item, client }: { item: CaseItem; client?: Pick<ApiClient, "emergency"> }) {
  const f = item.forecast ?? null;
  const [feed, setFeed] = useState<EmergencyFeed | null>(null);
  useEffect(() => {
    if (!client?.emergency || !f?.location) return;
    let live = true;
    client.emergency().then((x) => { if (live) setFeed(x); }, () => undefined);
    return () => { live = false; };
  }, [client, f?.location]);
  const near = useMemo(() => {
    if (!feed || !f?.location) return [];
    return feed.alerts.filter((a) => isWarning(a.alertLevel)).map((a) => {
      const pts = [...(a.centre ? [a.centre] : []), ...a.polygons.flat()];
      return { a, km: pts.length ? Math.min(...pts.map((p) => km(f.location!, p))) : Infinity };
    }).filter((x) => x.km <= NEAR_KM).sort((x, y) => x.km - y.km);
  }, [feed, f?.location]);
  const nearAlerts = useMemo(() => near.map((x) => x.a), [near]);

  if (!f) return null;
  const signals = item.weatherSignals ?? [];
  const kinds = [...new Set(f.hazards.map((h) => h.kind))];
  const suburb = item.person?.suburb ?? f.town;

  return (
    <section className="case-card vis-card vis-wide" aria-labelledby="vis-wx">
      <h2 id="vis-wx">Weather and warnings this week</h2>
      <div className="case-wx">
        {f.location ? (
          <Suspense fallback={<div className="case-wx-map" role="status">Loading the map…</div>}>
            <CaseWeatherMap location={f.location} label={`${suburb} (suburb centre)`} alerts={nearAlerts} />
          </Suspense>
        ) : null}
        <div className="case-wx-info">
          <section className="wx-block" aria-labelledby="wx-fc">
            <h3 id="wx-fc" className="wx-head"><span>Forecast</span><span className="sub">{f.town} · {f.district}</span></h3>
            <ol className="case-wx-days">
              {f.days.map((d) => (
                <li key={d.date} title={d.precis}>
                  <span className="wx-day">{dayName(d.date)}<span className="sub"> {dayDate(d.date)}</span></span>
                  <span className="case-wx-max" style={tempColor(d.max)}>{d.max ?? "–"}°</span>
                  <span className="sub">{d.min ?? "–"}°</span>
                </li>
              ))}
            </ol>
            {kinds.length ? null : <p className="muted wx-none">No hot or dangerous weather forecast this week.</p>}
          </section>

          <section className="wx-block" aria-labelledby="wx-sig">
            <h3 id="wx-sig" className="wx-head"><span>Weather signals</span>{signals.length ? <span className="pill">{signals.length}</span> : null}</h3>
            {signals.length ? (
              <ul className="plain wx-items">{signals.map((s) => (
                <li key={s.id}>
                  <span className="wx-icon" aria-hidden="true">{SIGNAL_ICON[s.id] ?? "•"}</span>
                  <div><strong>{s.name}</strong><span className="sub">{readableDates(s.evidence)}</span></div>
                </li>
              ))}</ul>
            ) : <p className="muted wx-none">None: nothing in the forecast reaches the signal limits.</p>}
          </section>

          <section className="wx-block" aria-labelledby="wx-ewa">
            <h3 id="wx-ewa" className="wx-head"><span>Emergency WA</span><span className="sub">within {NEAR_KM} km</span>{near.length ? <span className="pill">{near.length}</span> : null}</h3>
            {!feed ? <p className="muted wx-none">Loading warnings…</p> : !feed.available ? <p className="muted wx-none">Emergency WA isn’t available right now.</p> : near.length ? (
              <ul className="plain wx-items">
                {near.map(({ a, km: d }) => (
                  <li key={a.id}>
                    <svg className="wx-icon" viewBox="0 0 22 20" width="22" height="20" aria-hidden="true"><path d="M11 1.5 L20.5 18.5 H1.5 Z" fill={alertColor(a.alertLevel)} stroke="#253858" strokeWidth="1.5" strokeLinejoin="round" /><path d="M11 7v5" stroke="#253858" strokeWidth="2" strokeLinecap="round" /><circle cx="11" cy="15" r="1.1" fill="#253858" /></svg>
                    <div><strong>{a.headline || a.alertLevel}</strong>
                    <span className="sub">{a.alertLevel} · {d < 1 ? "under 1 km away" : `${Math.round(d)} km away`}{a.web ? <> · <a href={a.web} target="_blank" rel="noreferrer">Details</a></> : null}</span></div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted wx-none">No warnings near {suburb}.</p>}
          </section>
          {f.climate ? <LongTermHeat c={f.climate} /> : null}
        </div>
      </div>
    </section>
  );
}

/** Where the customer sits on the weather outlook this week: act now, watch or neither, and why. */
export function OutlookBanner({ f }: { f: NonNullable<CaseItem["forecast"]> }) {
  const o = f.outlook;
  if (!o) return null;
  const needs = o.sensitivity;
  const why = o.tier === "act"
    ? o.exposure >= 3 ? "Dangerous weather is coming and they have a health or supply need. Contact them before it hits." : "A hot day is coming and they have a critical need, such as life support or a supply that could stop. Contact them before it hits."
    : o.tier === "watch"
      ? needs.length ? "Hot or dangerous weather is coming, and their needs add up. Check in if you can." : "Dangerous weather is coming and their predicted risk is high. Check in if you can."
      : o.exposure > 0 ? "Hot weather is coming, but nothing we know makes it riskier for them." : "No hot or dangerous weather is forecast for them this week.";
  return (
    <>
      <div className={`outlook-banner outlook-${o.tier ?? "none"}`}>
        <strong className="ob-tier">{o.tier === "act" ? "Act now" : o.tier === "watch" ? "Watch" : "Not on the outlook"}</strong>
      </div>
      <p className="ob-why">{why}</p>
    </>
  );
}

/** Very hot days a year where the customer lives, now and around 2050: a longer view than this week's forecast. */
function LongTermHeat({ c }: { c: NonNullable<NonNullable<CaseItem["forecast"]>["climate"]> }) {
  const max = Math.max(1, c.hot, c.hot2050 ?? 0);
  const bar = (n: number | null, cls: string) => <span className="lt-bar"><i className={cls} style={{ width: `${((n ?? 0) / max) * 100}%` }} /></span>;
  const n = (v: number) => (v < 1 && v > 0 ? "under 1" : String(Math.round(v)));
  return (
    <section className="wx-block" aria-labelledby="wx-lt">
      <h3 id="wx-lt" className="wx-head"><span>Long-term heat</span><span className="sub">days a year at {c.thresholds.hot}°C or more</span></h3>
      <ul className="plain lt-rows">
        <li><span>Now <span className="sub">{c.baselineYears[0]}–{c.baselineYears[1]} average</span></span>{bar(c.hot, "lt-now")}<strong>{n(c.hot)}</strong></li>
        {c.hot2050 !== null ? <li><span>Around 2050 <span className="sub">{c.period}, {c.scenario}</span></span>{bar(c.hot2050, "lt-future")}<strong>{n(c.hot2050)}</strong></li> : null}
      </ul>
      <p className="sub">
        {c.thresholds.veryHot}°C or more: {n(c.veryHot)} a year now{c.veryHot2050 !== null ? `, about ${n(c.veryHot2050)} around 2050` : ""}. Average summer maximum {c.summerMax}°C.
        {" "}A middle emissions path; a guide to long-term exposure, not a forecast.
      </p>
    </section>
  );
}
