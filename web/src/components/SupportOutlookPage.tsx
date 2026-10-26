import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { SUPPORT_GROUPS, SUPPORT_GROUP_COLORS, SUPPORT_URGENCY, emptySupportCounts, supportUrgency, type SupportGroupId } from "@greenspark/shared";
import { SupportWeek } from "./SupportWeek";
import { SupportWeatherKey } from "./SupportWeatherKey";
import { SupportSolutions } from "./SupportSolutions";
import { SupportActions, type ActionsClient } from "./SupportActions";
import type { ApiClient, EmergencyFeed, Outlook, OutlookCustomer } from "../data/api";
import { accountHref, isModifiedClick } from "../route";
import { customerOnDate, groupOf, inMapRegion, REGION_LABEL, supportAreas, type MapRegion } from "../domain/supportGroups";
import { dayDate, dayName, isWarning, tempColor } from "./outlookText";
import { band, percent } from "./predictionText";
import "./supportOutlook.css";

const SupportMap = lazy(() => import("./SupportMap").then((m) => ({ default: m.SupportMap })));
const PAGE = 50;
const ALL_GROUPS = SUPPORT_GROUPS.map((item) => item.id);
const groupStyle = (group: SupportGroupId): CSSProperties => ({ "--group-strong": SUPPORT_GROUP_COLORS[group].strong, "--group-light": SUPPORT_GROUP_COLORS[group].light, "--group-ink": SUPPORT_GROUP_COLORS[group].ink }) as CSSProperties;

/** Staff plan by action and area first; customer records remain a drill-down. */
export function SupportOutlookPage({ client, navigate }: { client: Pick<ApiClient, "outlook" | "emergency"> & ActionsClient; navigate: (to: string) => void }) {
  const [data, setData] = useState<Outlook | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tier, setTier] = useState<"" | "act" | "watch">(() => { const value = new URLSearchParams(window.location.search).get("tier"); return value === "act" || value === "watch" ? value : ""; });
  const [groups, setGroups] = useState<SupportGroupId[]>(() => new URLSearchParams(window.location.search).has("tier") ? ALL_GROUPS : ALL_GROUPS.filter((id) => id !== "monitor"));
  const group = groups.length === 1 ? groups[0]! : "all";
  const [region, setRegion] = useState<MapRegion>("perth"), [date, setDate] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [onlyExposed, setOnlyExposed] = useState(false), [showHeat, setShowHeat] = useState(true), [showAlerts, setShowAlerts] = useState(true);
  const [showCustomers, setShowCustomers] = useState(false), [shown, setShown] = useState(PAGE);
  const [emergency, setEmergency] = useState<EmergencyFeed | null>(null);
  const [supportTab, setSupportTab] = useState<"solutions" | "actions">("solutions");

  useEffect(() => {
    if (!client.outlook) { setError("The weather outlook isn't available on this server."); return; }
    let current = true, loaded = false;
    const load = () => client.outlook!().then((result) => {
      if (!current) return;
      loaded = true; setData(result); setError(null); setNotice(null);
    }, (failure: unknown) => {
      if (!current) return;
      const message = failure instanceof Error ? failure.message : "Could not load the outlook.";
      if (loaded) setNotice(`Refresh failed. Showing the last loaded forecast. ${message}`); else setError(message);
    });
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { current = false; window.clearInterval(timer); };
  }, [client, retry]);
  useEffect(() => {
    if (!client.emergency) return;
    let current = true;
    const load = () => client.emergency!().then((result) => { if (current) setEmergency(result); }, () => undefined);
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => { current = false; window.clearInterval(timer); };
  }, [client]);
  useEffect(() => { document.title = "New outlook · ERVEI"; }, []);
  useEffect(() => { setAreaId(null); }, [region]);
  useEffect(() => { setShown(PAGE); setShowCustomers(false); }, [groups, region, date, tier, onlyExposed]);

  const ready = data?.available ? data : null;
  const baseRows = useMemo(() => (ready?.groupCustomers ?? ready?.customers ?? [])
    .map((customer) => customerOnDate(customer, date))
    .filter((customer) => inMapRegion(customer, region) && (!tier || customer.tier === tier) && (!onlyExposed || customer.exposure > 0)), [ready, date, region, tier, onlyExposed]);
  const groupCounts = useMemo(() => {
    const counts = emptySupportCounts();
    for (const customer of baseRows) counts[groupOf(customer)]++;
    return counts;
  }, [baseRows]);
  const rows = useMemo(() => baseRows.filter((customer) => groups.includes(groupOf(customer))), [baseRows, groups]);
  const mapped = useMemo(() => supportAreas(rows, true), [rows]);
  const postcodeCount = new Set(mapped.areas.map((area) => area.postcode)).size;
  const selectedPostcode = areaId?.split(":")[0] ?? null;
  const picked = mapped.areas.find((area) => area.id === areaId) ?? mapped.areas.find((area) => area.postcode === selectedPostcode) ?? null;
  const areaOptions = useMemo(() => supportAreas(rows).areas, [rows]);
  const scopeLabel = selectedPostcode ? `${baseRows.find((c) => c.postcode === selectedPostcode)?.suburb ?? "Area"} · postcode ${selectedPostcode}` : REGION_LABEL[region];
  const members = useMemo(() => rows.filter((customer) => !selectedPostcode || customer.postcode === selectedPostcode).sort((a, b) => SUPPORT_URGENCY[supportUrgency(b.tier)].rank - SUPPORT_URGENCY[supportUrgency(a.tier)].rank || b.score - a.score), [selectedPostcode, rows]);
  const selectedDefinition = SUPPORT_GROUPS.find((item) => item.id === group);
  const selectionLabel = groups.length === ALL_GROUPS.length ? "All support groups" : `${groups.length} support groups`;
  const act = members.filter((customer) => customer.tier === "act").length;
  const watch = members.filter((customer) => customer.tier === "watch").length;
  const warnings = (emergency?.alerts ?? []).filter((alert) => isWarning(alert.alertLevel));
  const period = date ? `${dayName(date)} ${dayDate(date)}` : "Next 7 days";
  const forecastStart = ready?.days[0]?.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Perth" });
  const weekStart = new Date(`${forecastStart}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
  const eventDate = weekStart.toISOString().slice(0, 10);
  const defaultDue = date || members.map((c) => c.firstDate).filter((d): d is string => !!d).sort()[0] || forecastStart;

  if (error) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="alert"><h1>We couldn’t load the outlook</h1><p>{error}</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div></main>;
  if (!data) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="status"><p>Loading the forecast…</p></div></main>;
  if (!ready) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty"><h1>No forecast yet</h1><p>{data.weather.error ? `The Bureau couldn’t be reached: ${data.weather.error}` : "The forecast is loading, or weather is switched off. Choose a source in Demo settings."}</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div></main>;

  const review = () => { setShowCustomers(true); setShown(PAGE); requestAnimationFrame(() => document.getElementById("group-customers")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const open = (event: React.MouseEvent, customer: OutlookCustomer) => { if (!customer.accountNumber || isModifiedClick(event)) return; event.preventDefault(); navigate(accountHref(customer.accountNumber)); };

  return <main id="queue" className="outlook support-outlook" tabIndex={-1}>
    <header className="page-head">
      <div><p className="eyebrow">Weather outlook · support groups</p><h1>Support before the heat</h1><p className="hint">Find groups to contact before dangerous weather arrives.</p></div>
      <div className="outlook-source">{ready.demo ? null : <span className="demo-pill">Live Bureau forecast</span>}<span className="sub">{ready.issuedAt ? `Issued ${new Date(ready.issuedAt).toLocaleString("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Issue time not given"}</span></div>
    </header>
    {notice || ready.weather.error ? <p className="support-notice" role="status">{notice ?? `Weather refresh failed: ${ready.weather.error}. Showing the last available forecast.`}</p> : null}

    <SupportWeek data={ready} region={region} groups={groups} date={date} onDate={setDate} />


    <section className="panel support-workspace" aria-label="Group map and support plan">
      <div className="support-map-toolbar">
        <p aria-live="polite"><strong>{selectedDefinition?.label ?? selectionLabel}</strong> · {rows.length.toLocaleString("en-AU")} customers across {postcodeCount} postcode areas</p>
        <div className="support-map-controls" role="group" aria-label="Map controls">
          <label className="support-region"><span className="sr-only">Map area</span><select aria-label="Map area" value={region} onChange={(event) => setRegion(event.target.value as MapRegion)}>{Object.entries(REGION_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <div className="support-time" role="group" aria-label="Forecast period">
            <strong>Forecast period</strong><button type="button" aria-pressed={!date} className={!date ? "is-on" : ""} onClick={() => setDate("")}>Whole week</button>
            {ready.days.map((day) => <button key={day.date} type="button" className={day.date === date ? "is-on" : ""} aria-pressed={day.date === date} onClick={() => setDate(day.date)}><span>{dayName(day.date)}</span>{dayDate(day.date)}</button>)}
          </div>
          <div className="support-layer-controls">
            <label className="check"><input type="checkbox" checked={showHeat} onChange={() => setShowHeat((value) => !value)} /><span>Temperature layer</span></label>
            <label className="check"><input type="checkbox" checked={showAlerts && !!emergency?.available} disabled={!emergency?.available} onChange={() => setShowAlerts((value) => !value)} /><span>Emergency WA{emergency && !emergency.available ? " · unavailable" : ""}</span></label>
          </div>
        </div>
      </div>
      <div className="support-map-layout">
        <div className="support-map-column">
          <Suspense fallback={<div className="outlook-map support-map" role="status">Loading the map…</div>}><SupportMap areas={mapped.areas} towns={ready.towns} activeGroups={groups} alerts={warnings} showHeat={showHeat} showAlerts={showAlerts && !!emergency?.available} chosen={picked?.id ?? null} onChoose={(id) => { setAreaId(id); setShown(PAGE); }} region={region} date={date} legend={<SupportWeatherKey feed={emergency} enabled={showAlerts && !!emergency?.available} />} /></Suspense>
        </div>

        <aside className="support-detail support-solutions-panel" aria-label="Support plan for selected groups">
          <div className="support-group-filters support-group-filters-panel" role="group" aria-label="Primary support group">
            <button type="button" className={`support-filter support-filter-all${groups.length === ALL_GROUPS.length ? " is-on" : ""}`} aria-pressed={groups.length === ALL_GROUPS.length} onClick={() => setGroups(ALL_GROUPS)}>All groups <span>{baseRows.length.toLocaleString("en-AU")}</span></button>
            {SUPPORT_GROUPS.map((item) => <button key={item.id} type="button" style={groupStyle(item.id)} className={`support-filter${groups.includes(item.id) ? " is-on" : ""}`} aria-pressed={groups.includes(item.id)} onClick={() => setGroups((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}><i>{item.letter}</i>{item.label}<span>{groupCounts[item.id].toLocaleString("en-AU")}</span></button>)}
          </div>
          <div className="support-detail-title"><div><p className="eyebrow">Support plan</p><h2>{supportTab === "solutions" ? "Solutions" : "Actions"}</h2><p className="sub">{scopeLabel}</p></div></div>
          <div className="support-panel-tabs" role="tablist" aria-label="Support plan view" onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault(); const next = event.key === "Home" ? "solutions" : event.key === "End" ? "actions" : supportTab === "solutions" ? "actions" : "solutions";
              setSupportTab(next); document.getElementById(`support-tab-${next}`)?.focus();
            }
          }}>{(["solutions", "actions"] as const).map((tab) => <button key={tab} id={`support-tab-${tab}`} role="tab" type="button" aria-selected={supportTab === tab} tabIndex={supportTab === tab ? 0 : -1} aria-controls={`support-panel-${tab}`} onClick={() => setSupportTab(tab)}>{tab === "solutions" ? "Solutions" : "Actions"}</button>)}</div>
          <p className="support-member-count"><strong>{members.length.toLocaleString("en-AU")}</strong> customers</p>
          <p className="sub">{selectedPostcode ? "All selected groups in this postcode" : "Select a circle to plan local support"}</p>
          {supportTab === "solutions" ? <div className="support-attention" aria-live="polite"><strong>{act ? `${act} need urgent review` : watch ? `${watch} to review soon` : "Monitor and check recorded needs"}</strong><span>{period} · {act ? "prioritise these customers today" : "review before the relevant forecast event"}</span></div> : <p className="task-attention-summary">{act ? `${act} need urgent review` : watch ? `${watch} to review soon` : "Monitor and follow up"} · {period}</p>}
          <details className="support-area-picker"><summary>Choose an area ({postcodeCount})</summary><div>{areaOptions.map((area) => <button key={area.id} type="button" aria-pressed={area.postcode === selectedPostcode} onClick={() => { setAreaId(mapped.areas.find((item) => item.postcode === area.postcode)!.id); setShown(PAGE); }}><span>{area.suburb}<small>{area.postcode} · {SUPPORT_URGENCY[area.urgency].label}</small></span><strong>{area.count}</strong></button>)}</div></details>
          {selectedPostcode ? <button type="button" className="link-btn" onClick={() => setAreaId(null)}>Show the whole region</button> : null}
          <div id="support-panel-solutions" role="tabpanel" aria-labelledby="support-tab-solutions" hidden={supportTab !== "solutions"}>
          <SupportSolutions customers={members} groups={groups} period={period} focusGroup={picked?.group ?? null} />
          <p className="support-caution">Suggested support steps. Confirm individual needs, consent and eligibility before acting.</p>
          <button type="button" className="btn support-review" disabled={!members.length} onClick={review}>Review {selectedPostcode ? "this area" : "group"} <span aria-hidden="true">→</span></button>
          </div>
          <div id="support-panel-actions" role="tabpanel" aria-labelledby="support-tab-actions" hidden={supportTab !== "actions"}>{supportTab === "actions" ? <SupportActions client={client} customers={members} groups={groups} scope={scopeLabel} eventDate={eventDate} defaultDue={defaultDue} focusGroup={picked?.group ?? null} /> : null}</div>
        </aside>
      </div>
    </section>

    <div className="support-scope">
      <label className="check"><input type="checkbox" checked={onlyExposed} onChange={() => setOnlyExposed((value) => !value)} /><span>Only customers exposed to forecast hazards</span></label>
      <label>Attention <select aria-label="Attention filter" value={tier} onChange={(event) => setTier(event.target.value as typeof tier)}><option value="">All attention levels</option><option value="act">Act now</option><option value="watch">Review soon</option></select></label>
      <span className="sub">{ready.totals.covered.toLocaleString("en-AU")} forecast-covered · {ready.totals.uncovered} without forecast coverage{mapped.unplaced ? ` · ${mapped.unplaced} without a map location in this selection` : ""}</span>
    </div>
    {!rows.length ? <div className="empty"><h2>{groups.length ? "No customers match this selection" : "Select a support group"}</h2><p>Turn on one or more coloured group filters, or clear the attention and exposure filters.</p><button type="button" className="btn" onClick={() => { setGroups(ALL_GROUPS); setRegion("wa"); setTier(""); setOnlyExposed(false); }}>Show all covered customers</button></div> : null}

    <details id="group-customers" className="panel support-customer-detail" open={showCustomers} onToggle={(event) => setShowCustomers(event.currentTarget.open)}>
      <summary>Customers in {selectedPostcode ? scopeLabel : "selected groups"} <span className="pill">{members.length}</span></summary>
      <p className="hint">Urgent customers first. Open a case to check the evidence and agree suitable support.</p>
      <div className="table-wrap"><table className="case-table support-customer-table"><thead><tr><th scope="col">Attention</th><th scope="col">Customer</th><th scope="col">Recorded needs</th><th scope="col">90-day predicted risk</th></tr></thead><tbody>
        {members.slice(0, shown).map((customer) => { const urgency = SUPPORT_URGENCY[supportUrgency(customer.tier)], risk = customer.risk ? band(customer.risk.probability, customer.risk.baseRate) : null; return <tr key={customer.personId}>
          <td><span className="support-urgency-pill" style={{ background: urgency.color, color: urgency.text }}>{urgency.label}</span></td>
          <td>{customer.accountNumber ? <a className="name-link" href={accountHref(customer.accountNumber)} onClick={(event) => open(event, customer)}>{customer.displayName}</a> : customer.displayName}<span className="sub">{customer.accountNumber} · {customer.suburb}</span></td>
          <td>{customer.sensitivity.map((signal) => signal.label).join(" · ") || "No matching recorded sensitivity; review information"}</td>
          <td>{customer.risk && risk ? <span className={`pred-pill pred-${risk.id}`} title={`${percent(customer.risk.probability)} chance of any harm in 90 days`}>{risk.text}</span> : <span className="sub">No score</span>}</td>
        </tr>; })}
      </tbody></table></div>
      <div className="pager"><span>Showing {Math.min(shown, members.length)} of {members.length}</span>{shown < members.length ? <button type="button" className="btn btn-small" onClick={() => setShown((value) => value + PAGE)}>Show {Math.min(PAGE, members.length - shown)} more</button> : null}</div>
    </details>

    <details className="panel support-forecast-detail"><summary>Weather forecast by town</summary><p className="hint">Daily maximum temperatures. The map estimates the colour between these town forecasts; the labels show the town values.</p><div className="table-wrap"><table className="town-table"><thead><tr><th scope="col">Forecast town</th>{ready.days.map((day) => <th key={day.date} scope="col">{dayName(day.date)} {dayDate(day.date)}</th>)}</tr></thead><tbody>{ready.towns.map((town) => <tr key={town.id}><th scope="row">{town.name}<span className="sub">{town.districtName}</span></th>{ready.days.map((day) => { const value = town.days.find((item) => item.date === day.date); return <td key={day.date} style={tempColor(value?.max ?? null)}>{value?.max === null || value?.max === undefined ? "–" : `${value.max}°C`}</td>; })}</tr>)}</tbody></table></div></details>



    <details className="panel outlook-how"><summary>How the grouping and map work</summary><ul>
      <li><strong>Six primary action groups:</strong> interrupted or low-credit supply first, then health, other supply needs, concession renewal, payment support, energy coaching and monitoring. Other recorded needs remain available as secondary tags and solutions. An active concession alone does not establish a need for payment support.</li>
      <li><strong>Solutions:</strong> selected groups have their own coloured cards. The same solution is shown once when it applies across multiple groups, counting each relevant customer once. Clicking a circle scopes all selected groups to that postcode.</li>
      <li><strong>Circle size</strong> shows customer count. <strong>Colour</strong> identifies the support group. <strong>Darkness</strong> shows the highest weather-response urgency within that postcode group. Translucent fills reveal overlaps; symbols at a shared postcode are slightly offset for readability.</li>
      <li><strong>Act now</strong> combines hazardous weather with a recorded health or supply need. <strong>Review soon</strong> combines hot weather with needs that add up, or dangerous weather with high predicted risk. Monitor does not mean safe or fully assessed.</li>
      <li><strong>Forecast period</strong> recalculates attention from that day’s hazards. Group membership comes from recorded signals. A warning remains relevant until its expiry.</li>
      <li><strong>Temperature shading</strong> estimates the daily maximum between nearby town forecasts, using a fixed °C scale. Blank areas are cooler than 28°C or outside available coverage. Whole week shows each town’s peak, which can occur on different days; select a date to compare the same day. It is not BoM’s official heatwave-severity product. {ready.demo ? "The current forecast values are fictional demo inputs." : "Town forecast values come from the Bureau."}</li>
      <li><strong>Approximate locations:</strong> circles use postcode centres. {ready.totals.uncovered} customers lack forecast coverage and are not included here. Check their cases separately.</li>
      <li><strong>Staff decide:</strong> these groups suggest work to review. They do not send messages, change accounts or determine eligibility.</li>
    </ul></details>
  </main>;
}
