// The weather outlook as it was before the grouped support workspace became the home page: the act-now and
// watch list, the week ahead and the town table. Kept as its own page under "Classic outlook".
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ApiClient, EmergencyFeed, HazardKind, Outlook, OutlookCustomer } from "../data/api";
import { accountHref, isModifiedClick } from "../route";
import { band, percent } from "./predictionText";
import { CONTACT_BADGE, CONTACT_BY, OutlookWeekList, contactRank } from "./OutlookWeekList";
import { ALERT_LEVELS, GROUP_LABEL, HAZARD_HINT, HAZARD_ICON, HAZARD_LABEL, alertColor, dayDate, isWarning, dayName, tempColor } from "./outlookText";

// Leaflet only loads with this page.
const OutlookMap = lazy(() => import("./OutlookMap").then((m) => ({ default: m.OutlookMap })));
const PAGE = 50;
const LAYERS_KEY = "outlook-map-layers";
type Layers = { towns: boolean; alerts: boolean };
function storedLayers(): Layers {
  try { const v = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "null") as Partial<Layers> | null; return { towns: v?.towns ?? true, alerts: v?.alerts ?? true }; } catch { return { towns: true, alerts: true }; }
}
type Group = keyof typeof GROUP_LABEL;

/** The home page: the next week's weather across WA and the customers it could put at risk, so staff can call first. */
const VIEW_KEY = "contact-list-view";
const storedView = (): "week" | "table" => { try { return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "week"; } catch { return "week"; } };

interface Tile { value: string; label: string; icon: string; color: string; count: number }
/** One filter as a row of big picture tiles: tap one to choose it, tap it again (or "All") to clear. */
function TileRow({ title, tiles, value, onChange }: { title: string; tiles: Tile[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="gf-row" role="group" aria-label={title}>
      <span className="gf-title">{title}</span>
      <div className="gf-tiles">
        {tiles.map((t) => (
          <button key={t.value} type="button" className="gf-tile" style={{ "--c": t.color } as React.CSSProperties} aria-pressed={value === t.value} onClick={() => onChange(value === t.value ? "" : t.value)}>
            <span className="gf-ico" aria-hidden="true">{t.icon}</span>
            <span className="gf-text"><strong>{t.label}</strong><span>{t.count.toLocaleString("en-AU")}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}
const WHO_TILES = [
  { value: "", label: "Act now and watch", icon: "●", color: "#00875a" },
  { value: "act", label: "Act now", icon: "!", color: "#ae2e24" },
  { value: "watch", label: "Watch", icon: "◐", color: "#c27a12" },
];
const WEATHER_COLOR: Record<string, string> = { heat: "#ae2e24", hot: "#c27a12", fire: "#e2683c", warning: "#b3361f" };
const NEED_TILES: Record<string, { icon: string; color: string }> = {
  health: { icon: "♥", color: "#b3361f" }, supply: { icon: "⚡", color: "#c27a12" }, cost: { icon: "$", color: "#2f5fa7" }, isolation: { icon: "◎", color: "#6c3fb0" },
};

export function ContactListPage({ client, navigate }: { client: Pick<ApiClient, "outlook" | "emergency">; navigate: (to: string) => void }) {
  const [data, setData] = useState<Outlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // The funnel links here with ?tier=act.
  const [tier, setTier] = useState<"" | "act" | "watch">(() => { const t = new URLSearchParams(window.location.search).get("tier"); return t === "act" || t === "watch" ? t : ""; });
  const [hazard, setHazard] = useState<"" | HazardKind>("");
  const [group, setGroup] = useState<"" | Group>("");
  const [town, setTown] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [emergency, setEmergency] = useState<EmergencyFeed | null>(null);
  // Which map layers are on is a per-browser preference.
  const [layers, setLayers] = useState<Layers>(storedLayers);
  const [view, setView] = useState<"week" | "table">(storedView);
  const chooseView = (v: "week" | "table") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* optional */ } };
  const toggle = (k: keyof Layers) => setLayers((l) => { const n = { ...l, [k]: !l[k] }; try { localStorage.setItem(LAYERS_KEY, JSON.stringify(n)); } catch { /* optional */ } return n; });

  // Emergency WA warnings load on their own, and again every 5 minutes, so they never hold up the outlook.
  useEffect(() => {
    if (!client.emergency) return;
    let current = true;
    const load = () => client.emergency!().then((f) => { if (current) setEmergency(f); }, () => undefined);
    void load();
    const t = window.setInterval(load, 5 * 60 * 1000);
    return () => { current = false; window.clearInterval(t); };
  }, [client]);

  useEffect(() => {
    if (!client.outlook) { setError("The weather outlook isn't available on this server."); return; }
    let current = true;
    setError(null);
    client.outlook().then((d) => { if (current) setData(d); }, (e: unknown) => { if (current) setError(e instanceof Error ? e.message : "Could not load the outlook."); });
    return () => { current = false; };
  }, [client, retry]);
  useEffect(() => { document.title = "Contact list · ERVEI"; }, []);
  useEffect(() => setShown(PAGE), [tier, hazard, group, town]);

  // Clicking a town's Act or Watch count narrows the list below to those customers and brings it into view.
  const showTier = (id: string, which: "act" | "watch") => {
    setTown(id); setTier(which);
    requestAnimationFrame(() => document.getElementById("who-title")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const ready = data?.available ? data : null;
  const townsById = useMemo(() => new Map(ready?.towns.map((t) => [t.id, t]) ?? []), [ready]);
  // The outlook comes first: by contact day, then the first hazard date; the server's order (act now, then score) breaks ties.
  const rows = useMemo(() => (ready?.customers ?? []).filter((c) =>
    (!tier || c.tier === tier) && (!hazard || c.kinds.includes(hazard)) && (!group || c.sensitivity.some((s) => s.group === group)) && (!town || c.townId === town),
  ).map((c) => ({ c, rank: contactRank(c, ready!.today) })).sort((x, y) => x.rank - y.rank || (x.c.firstDate ?? "9").localeCompare(y.c.firstDate ?? "9")).map((x) => x.c), [ready, tier, hazard, group, town]);

  if (error) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="alert"><h1>We couldn’t load the outlook</h1><p>{error}</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div></main>;
  if (!data) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="status"><p>Loading the forecast…</p></div></main>;
  if (!ready) {
    return (
      <main id="queue" className="outlook" tabIndex={-1}>
        <div className="empty"><h1>No forecast yet</h1><p>{data.weather.error ? `The Bureau couldn’t be reached: ${data.weather.error}` : "The forecast is still loading, or weather is switched off on this server."} Choose a weather source in Demo settings (the gear, top right).</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div>
      </main>
    );
  }

  // How many customers each tile would give, with the other filters and the chosen town still applied.
  const fits = (c: OutlookCustomer, t: string, h: string, g: string) =>
    (!t || c.tier === t) && (!h || c.kinds.includes(h as HazardKind)) && (!g || c.sensitivity.some((x) => x.group === g)) && (!town || c.townId === town);
  const open = (e: React.MouseEvent, c: OutlookCustomer) => {
    if (!c.accountNumber || isModifiedClick(e)) return;
    e.preventDefault();
    navigate(accountHref(c.accountNumber));
  };
  // Only real warnings go on the map; other notices, such as park closures, are left off.
  const warnings = (emergency?.alerts ?? []).filter((a) => isWarning(a.alertLevel));
  const towns = [...ready.towns].sort((a, b) => b.act - a.act || b.watch - a.watch || b.exposed - a.exposed || a.name.localeCompare(b.name));
  const chosen = town ? townsById.get(town) : null;
  const filtered = !!(tier || hazard || group || town);

  return (
    <main id="queue" className="outlook" tabIndex={-1}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Contact list · next 7 days</p>
          <h1>Who to contact before the weather hits</h1>
          <p className="hint">
            The Bureau’s forecast for each customer’s area, matched against what we know about them: health, a supply that could stop, the cost of cooling, isolation.
          </p>
        </div>
        <div className="outlook-source">
          {ready.demo ? null : <span className="demo-pill">Live Bureau forecast</span>}
          <span className="sub">{ready.issuedAt ? `Issued ${new Date(ready.issuedAt).toLocaleString("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Issue time not given"}</span>
        </div>
      </div>

      <section className="outlook-kpis" aria-label="This week at a glance">
        <button type="button" className={`kpi kpi-act${tier === "act" ? " is-on" : ""}`} aria-pressed={tier === "act"} onClick={() => setTier(tier === "act" ? "" : "act")}>
          <strong>{ready.totals.act}</strong><span>Act now</span><small>Dangerous weather and a health or supply need</small>
        </button>
        <button type="button" className={`kpi kpi-watch${tier === "watch" ? " is-on" : ""}`} aria-pressed={tier === "watch"} onClick={() => setTier(tier === "watch" ? "" : "watch")}>
          <strong>{ready.totals.watch}</strong><span>Watch</span><small>Hot weather and needs that add up, or a high chance of hardship</small>
        </button>
        <div className="kpi">
          <strong>{ready.totals.exposed}</strong><span>In hazard areas</span><small>of {ready.totals.covered} customers near a forecast town</small>
        </div>
        <div className="kpi">
          <strong>{ready.warnings.length}</strong><span>Active warnings</span><small>{ready.warnings.length ? ready.warnings.map((w) => w.title).join("; ") : "None from the Bureau right now"}</small>
        </div>
      </section>

      <section className="panel outlook-places" aria-labelledby="places-title">
        <div className="panel-head">
          <h2 id="places-title">Where</h2>
        </div>
        <div className="panel-head map-keys">
          {layers.towns ? <>
          <span className="map-legend" aria-label="Colour shows the worst weather forecast">
            <span><i style={{ background: "#ae2e24" }} />Severe</span><span><i style={{ background: "#e2683c" }} />Dangerous</span>
            <span><i style={{ background: "#e0a030" }} />Hot day</span><span><i style={{ background: "#7a9cc6" }} />No hazard</span>
          </span>
          <span className="map-legend map-legend-symbols" aria-label="Symbols show the kinds of weather forecast">
            {(Object.keys(HAZARD_ICON) as HazardKind[]).map((k) => <span key={k}><span aria-hidden="true">{HAZARD_ICON[k]}</span>{HAZARD_LABEL[k]}</span>)}
          </span>
          </> : null}
          {layers.alerts && emergency?.available ? (
            <span className="map-legend" aria-label="Emergency WA warning levels">
              {ALERT_LEVELS.filter(([label]) => warnings.some((a) => alertColor(a.alertLevel) === alertColor(label))).map(([label, color]) => <span key={label}><svg className="tri" viewBox="0 0 22 20" width="13" height="12" aria-hidden="true"><path d="M11 1.5 L20.5 18.5 H1.5 Z" fill={color} stroke="#253858" strokeWidth="1.5" strokeLinejoin="round" /></svg>Emergency WA {label}</span>)}
            </span>
          ) : null}
        </div>
        <div className="outlook-places-body">
          <Suspense fallback={<div className="outlook-map" role="status">Loading the map…</div>}>
            <OutlookMap towns={ready.towns} alerts={warnings} showTowns={layers.towns} showAlerts={layers.alerts && !!emergency?.available} chosen={town} onChoose={setTown} controls={
          <span className="map-layers" role="group" aria-label="Show on the map">
            <label className="check switch"><input type="checkbox" role="switch" checked={layers.towns} onChange={() => toggle("towns")} /><span>Forecast towns</span></label>
            <label className="check switch">
              <input type="checkbox" role="switch" checked={layers.alerts} disabled={!emergency?.available} onChange={() => toggle("alerts")} />
              <span>Emergency WA warnings{emergency?.available ? null : <span className="sub"> {emergency ? "unavailable" : "loading…"}</span>}</span>
            </label>
          </span>
            } />
          </Suspense>
          <div className="town-table-wrap">
            <table className="town-table">
              <caption className="sr-only">Forecast maximum for each town, and its customers to contact</caption>
              <thead>
                <tr>
                  <th scope="col">Town</th>
                  {ready.days.map((d) => <th key={d.date} scope="col" className="t-day">{dayName(d.date).slice(0, 2)}</th>)}
                  <th scope="col" className="t-num">Act</th><th scope="col" className="t-num">Watch</th>
                </tr>
              </thead>
              <tbody>
                {towns.map((t) => (
                  <tr key={t.id} className={t.id === town ? "is-selected" : undefined}>
                    <th scope="row">
                      <button type="button" className="town-btn" aria-pressed={t.id === town} onClick={() => setTown(t.id === town ? null : t.id)}>{t.name}</button>
                      <span className="sub">{t.districtName}{t.hazards.length ? " · " : ""}{[...new Set(t.hazards.map((h) => h.kind))].map((k) => {
                        // The symbol's name, then what the forecast says: each day's temperature, the fire rating or the warning.
                        const tip = `${HAZARD_LABEL[k]}: ${HAZARD_HINT[k]}\n${t.hazards.filter((h) => h.kind === k).map((h) => h.text).join("\n")}`;
                        return <span key={k} className="hz-icon" title={tip} aria-label={tip} role="img">{HAZARD_ICON[k]}</span>;
                      })}</span>
                    </th>
                    {ready.days.map((d) => {
                      const day = t.days.find((x) => x.date === d.date);
                      return <td key={d.date} className="t-day" style={tempColor(day?.max ?? null)} title={day?.precis}>{day?.max ?? "–"}</td>;
                    })}
                    <td className="t-num">{t.act ? <button type="button" className="tier-btn n-act" title={`Show the ${t.act} act-now customers in ${t.name}`} onClick={() => showTier(t.id, "act")}>{t.act}</button> : ""}</td>
                    <td className="t-num">{t.watch ? <button type="button" className="tier-btn n-watch" title={`Show the ${t.watch} watch customers in ${t.name}`} onClick={() => showTier(t.id, "watch")}>{t.watch}</button> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="who-title">
        <div className="panel-head">
          <h2 id="who-title">Customers to contact before it hits <span className="pill">{rows.length}</span></h2>
        </div>
        <div className="graphic-filters">
          <TileRow title="Who" value={tier} onChange={(v) => setTier(v as typeof tier)} tiles={WHO_TILES.map((t) => ({ ...t, count: ready.customers.filter((c) => fits(c, t.value, hazard, group)).length }))} />
          <TileRow title="Weather" value={hazard} onChange={(v) => setHazard(v as typeof hazard)} tiles={[
            { value: "", label: "Any weather", icon: "◌", color: "#00875a", count: ready.customers.filter((c) => fits(c, tier, "", group)).length },
            ...(Object.keys(HAZARD_LABEL) as HazardKind[]).map((k) => ({ value: k, label: HAZARD_LABEL[k], icon: HAZARD_ICON[k], color: WEATHER_COLOR[k] ?? "#5e6c84", count: ready.customers.filter((c) => fits(c, tier, k, group)).length })),
          ]} />
          <TileRow title="Need" value={group} onChange={(v) => setGroup(v as typeof group)} tiles={[
            { value: "", label: "Any need", icon: "◌", color: "#00875a", count: ready.customers.filter((c) => fits(c, tier, hazard, "")).length },
            ...(Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ value: g, label: GROUP_LABEL[g], icon: NEED_TILES[g]?.icon ?? "•", color: NEED_TILES[g]?.color ?? "#5e6c84", count: ready.customers.filter((c) => fits(c, tier, hazard, g)).length })),
          ]} />
          {chosen ? <span className="chip">{chosen.name}<button type="button" aria-label={`Remove town ${chosen.name}`} onClick={() => setTown(null)}>✕</button></span> : null}
          {filtered ? <button type="button" className="link-btn" onClick={() => { setTier(""); setHazard(""); setGroup(""); setTown(null); }}>Clear</button> : null}
        </div>
        {rows.length === 0 ? (
          <div className="empty"><h3>No one to contact{filtered ? " with these filters" : ""}</h3><p>{filtered ? "Try clearing a filter." : "The forecast has no hot or dangerous weather where our customers live this week."}</p></div>
        ) : (
          <>
          <div className="view-toggle" role="group" aria-label="List view">
            <button type="button" className="btn btn-small" aria-pressed={view === "week"} onClick={() => chooseView("week")}>Week view</button>
            <button type="button" className="btn btn-small" aria-pressed={view === "table"} onClick={() => chooseView("table")}>Table</button>
          </div>
          {view === "week" ? <div className="table-wrap"><OutlookWeekList rows={rows.slice(0, shown)} towns={townsById} dates={ready.days.map((d) => d.date)} today={ready.today} navigate={navigate} /></div> : (
          <div className="table-wrap">
            <table className="case-table outlook-table">
              <thead>
                <tr>
                  <th scope="col">Outlook</th><th scope="col">Customer</th><th scope="col">Weather coming</th>
                  <th scope="col">Why they’re vulnerable</th><th scope="col">Contact by</th><th scope="col">Chance of hardship <span className="sim">90 days</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((c) => {
                  const b = c.risk ? band(c.risk.probability, c.risk.baseRate) : null;
                  return (
                    <tr key={c.personId} onClick={() => c.accountNumber && navigate(accountHref(c.accountNumber))}>
                      <td><span className={`badge ${c.tier === "act" ? "badge-urgent" : "badge-high"}`}>{c.tier === "act" ? "Act now" : "Watch"}</span></td>
                      <td>
                        {c.accountNumber ? <a className="name-link" href={accountHref(c.accountNumber)} onClick={(e) => { e.stopPropagation(); open(e, c); }}>{c.displayName}</a> : <strong>{c.displayName}</strong>}
                        <span className="sub">{c.suburb}</span>
                      </td>
                      <td>
                        <span className="wx-kinds">{c.kinds.map((k) => <span key={k} title={HAZARD_LABEL[k]} aria-label={HAZARD_LABEL[k]}>{HAZARD_ICON[k]}</span>)}</span> {c.worst}
                        {(() => {
                          // A warning is in force now; the forecast's hot or dangerous days start on their own date.
                          const when = c.firstDate ? (c.firstDate === ready.today ? "today" : `${dayName(c.firstDate)} ${dayDate(c.firstDate)}`) : null;
                          const parts = [c.kinds.includes("warning") ? "Warning in place now" : null, when ? (c.kinds.includes("warning") ? `${c.firstKind === "fire" ? "fire danger" : "hot"} from ${when}` : `From ${when}`) : null].filter(Boolean);
                          return parts.length ? <span className="sub">{parts.join(" · ")}</span> : null;
                        })()}
                      </td>
                      <td>
                        <span className="need-chips">
                          {c.sensitivity.slice(0, 5).map((s) => <span key={s.id} className={`need need-${s.group}`} title={GROUP_LABEL[s.group]}>{s.label}</span>)}
                          {c.sensitivity.length > 5 ? <span className="need need-more">+{c.sensitivity.length - 5}</span> : null}
                          {!c.sensitivity.length ? <span className="sub">High chance of hardship</span> : null}
                        </span>
                      </td>
                      <td>
                        {(() => { const r = contactRank(c, ready.today); return <span className={`badge badge-${CONTACT_BADGE[r]}`}>{CONTACT_BY[r]}</span>; })()}
                      </td>
                      <td>{c.risk && b ? <span className={`pred-pill pred-${b.id}`} title={`${percent(c.risk.probability)} chance of any harm in 90 days`}>{b.text} · {percent(c.risk.probability)}</span> : <span className="sub">No prediction</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          </>
        )}
        <div className="pager">
          <span>{rows.length ? `Showing ${Math.min(shown, rows.length)} of ${rows.length}, soonest weather first, then act now, then by weather × need × chance of hardship` : ""}</span>
          {shown < rows.length ? <button type="button" className="btn btn-small" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button> : null}
        </div>
      </section>


      <details className="panel outlook-how">
        <summary>How the outlook works</summary>
        <ul>
          <li><strong>Weather</strong>: each customer’s postcode is matched to the nearest Bureau forecast town. Extreme heat is a forecast maximum of 38°C or more (42°C north of the 26th parallel, where 40°C is routine); a hot day is within 4°C of that. Extreme or Catastrophic fire danger, and heat, storm, fire, cyclone or flood warnings for the district, count as dangerous.</li>
          <li><strong>Needs</strong>: from the account (life support, disconnection warnings, prepay credit, arrears, outages, remote supply) and what customers have told us (medical need for cooling, illness, going without).</li>
          <li><strong>Act now</strong>: dangerous weather and a health or supply need, or any hot day for someone on life support, with a medical need for cooling, or whose supply has stopped or is about to. <strong>Watch</strong>: hot weather and needs that add up (a concession card alone doesn’t), or dangerous weather and a predicted 90-day risk at least 4× the average.</li>
          <li>{ready.totals.uncovered} customers live in postcodes without a nearby forecast town and aren’t shown.</li>
        </ul>
      </details>
    </main>
  );
}
