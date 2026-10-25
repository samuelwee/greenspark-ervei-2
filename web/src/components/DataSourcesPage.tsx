import { useEffect, useState } from "react";
import type { ApiClient, WeatherMode, WeatherStatus } from "../data/api";

interface Source { file: string; rows: string; contains: string; extracted: string; leftOut?: string }

/** The synthetic WA utility dataset files, and what scripts/import-utility-dataset.mts takes from each. */
const SOURCES: Source[] = [
  { file: "customers.csv", rows: "5,150", contains: "One row per customer: location, retailer, tariff, meter, payment method, solar, concession, life support, medical cooling subsidy, account dates.",
    extracted: "Suburb and postcode, retailer, plan and tariff, meter type, prepay, payment method, solar size, concession card, life support (and date), medical cooling subsidy, customer since.",
    leftOut: "Closed accounts (only open accounts were chosen); the opening position at 1 Jul 2023 (bills carry it instead)." },
  { file: "contact_preferences.csv", rows: "5,150", contains: "How each customer wants to be contacted.",
    extracted: "Preferred channel, SMS and email opt-in, do not call, consent to proactive support contact, online account, authorised representative, interpreter required." },
  { file: "postcode_context.csv", rows: "58", contains: "Region, retailer and climate details for each postcode.",
    extracted: "Region name, climate zone, north of the 26th parallel (the remote area signal).",
    leftOut: "The disadvantage quintile (marked PLACEHOLDER) and the census, SEIFA, heat and tree canopy columns (empty)." },
  { file: "bills.csv", rows: "56,266", contains: "Every bill: billing period, kWh, charges, credits, amount due, due dates, payment.",
    extracted: "All bills: period, issue and due dates, extensions, kWh (plus the same period last year from daily reads), usage and supply charges, concession, government and feed-in credits, amount due, date paid, paid on time, final and opening-balance bills." },
  { file: "payments.csv", rows: "47,888", contains: "Every payment, with method, kind and result.",
    extracted: "All payments: date, amount, method, kind (bill payment, instalment, HUGS grant, write-off) and whether it cleared or was dishonoured." },
  { file: "customer_month_panel.csv", rows: "110,631", contains: "Each customer's position at every month end, model features, and future-outcome labels.",
    extracted: "Month-end balance, overdue amount, days overdue and concession status (used for arrears growing and concession lapsed).",
    leftOut: "The label_* columns: they record what happened in the next 90 days, for training a model, and must not feed signals or priority. The other features are worked out again from the source records." },
  { file: "consumption_daily.csv.gz", rows: "3,491,513", contains: "Daily meter reads: import by time band, solar export, supply status, outage and self-disconnection hours.",
    extracted: "Monthly totals: kWh, solar export, outage hours, days disconnected; last year's figures for comparison." },
  { file: "consumption_halfhourly_event_windows.csv.gz", rows: "8,176,800", contains: "Half-hourly reads for a few event windows in 2024.",
    extracted: "Nothing.", leftOut: "All of it: the windows only cover parts of 2024, so there is nothing to compare against." },
  { file: "payment_arrangements.csv", rows: "1,767", contains: "Payment plans and bill extensions.",
    extracted: "Payment plans (status, instalments, amount, trigger, dates) and bill extensions (amount, until)." },
  { file: "hardship_programs.csv", rows: "345", contains: "Hardship assessments and programs.",
    extracted: "Every assessment and program: outcome, trigger, instalment, debt at entry, exit and reason, write-off, financial counselling and energy efficiency referrals. Gives the current hardship status." },
  { file: "hugs_grants.csv", rows: "263", contains: "Hardship Utility Grant Scheme applications.", extracted: "Applications: dates, debt, grant amount, approved or declined." },
  { file: "interventions.csv", rows: "3,423", contains: "Help offered or requested, with trial arms and outcomes at 30, 60 and 90 days.",
    extracted: "What was offered, why, by whom, whether it was accepted, and the detail.",
    leftOut: "Trial arms and the balance and outcome measurements after the offer (outcome data for evaluation)." },
  { file: "contacts.csv", rows: "11,110", contains: "Every contact: channel, direction, reason, outcome, sentiment, complaint, agent notes.",
    extracted: "All contacts, shown as Contact history; used for repeat contact, complaints and unanswered outreach." },
  { file: "contact_transcripts.jsonl", rows: "4,406", contains: "Conversation transcripts for some contacts.",
    extracted: "Attached to their contacts. What customers said in the last 12 months raises matching self-report signals (for example \"I lost my job a few weeks ago\" for Says: lost job)." },
  { file: "collection_events.csv", rows: "44,604", contains: "Collection notices: reminders, warnings, missed instalments, referrals, disconnections.",
    extracted: "All notices (disconnection warnings, plans broken, debt collection referrals and more)." },
  { file: "disconnections.csv", rows: "121", contains: "Disconnections for non-payment and reconnections.", extracted: "All disconnections; supply is \"disconnected\" when the latest has no reconnection." },
  { file: "outage_customer_impacts.csv", rows: "7,439", contains: "Which customers each outage affected, and for how long.", extracted: "Each customer's outages (start, end, hours) for the outage history signal." },
  { file: "outage_events.csv", rows: "355", contains: "Outage events by postcode: planned or not, cause, notice.",
    extracted: "Planned or unplanned, cause and notice date, joined to each customer's outages.", leftOut: "Postcode-level share affected, median duration and the \"anchored to a real event\" flag." },
  { file: "communications_log.csv.gz", rows: "114,720", contains: "Every message sent: type, channel, delivered, opened.",
    extracted: "The last message opened, and messages not delivered in the last 12 months (returned mail, digital disengagement).", leftOut: "Individual delivered messages." },
  { file: "prepay_daily.csv", rows: "109,650", contains: "Daily prepay credit, top-ups and usage cost.", extracted: "The credit on the last day.", leftOut: "The daily history." },
  { file: "prepay_topups.csv", rows: "15,287", contains: "Prepay top-ups with context (payday or after running out).", extracted: "Top-ups in the last 6 months." },
  { file: "prepay_self_disconnections.csv", rows: "8,320", contains: "Each time a prepay meter ran out of credit.", extracted: "Times in the last 12 months: start, hours without power, hot day." },
];

const MODES: [WeatherMode, string, string][] = [
  ["demo", "Sample heatwave", "A made-up week with a three-day heatwave over Perth and the Lower West, so there’s always weather to act on."],
  ["live", "Live Bureau data", "The Bureau's real forecasts and warnings, refreshed every hour. Usually quiet unless hot weather is coming."],
];

/** Shows which weather source the server is using, and lets anyone switch it for everyone. */
export function WeatherSource({ client }: { client: ApiClient }) {
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { client.weather?.().then(setStatus, () => setError("Couldn't load the weather status.")); }, [client]);
  if (!client.weather || !status) return error ? <p className="muted">{error}</p> : null;
  if (status.available === false) return <p className="muted">Weather signals aren't set up on this server.</p>;
  const choose = async (mode: WeatherMode) => {
    if (!client.setWeatherMode || mode === status.mode) return;
    setBusy(true);
    setError(null);
    try { setStatus(await client.setWeatherMode(mode)); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't change the weather source."); } finally { setBusy(false); }
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Perth", dateStyle: "medium", timeStyle: "short" }) : "not yet");
  return (
    <div className="wx-source">
      <div className="wx-modes" role="radiogroup" aria-label="Weather source">
        {MODES.map(([mode, label]) => (
          <button key={mode} type="button" role="radio" aria-checked={status.mode === mode} disabled={busy} onClick={() => void choose(mode)}>{label}</button>
        ))}
      </div>
      <p className="hint">{MODES.find((m) => m[0] === status.mode)?.[2]} Switching applies to everyone, straight away.</p>
      {status.mode !== "off" ? (
        <p className="hint">
          {busy ? "Loading the forecast…" : <>Forecast loaded {when(status.fetchedAt)}{status.mode === "live" && status.issuedAt ? `, issued by the Bureau ${when(status.issuedAt)}` : ""}. {status.towns} towns.
          {status.warnings.length ? ` Active warnings: ${status.warnings.join("; ")}.` : " No active warnings."}</>}
        </p>
      ) : null}
      {status.error ? <p className="muted">Last fetch failed: {status.error}. Showing the last good forecast.</p> : null}
      {error ? <p className="muted" role="alert">{error}</p> : null}
    </div>
  );
}

export function DataSourcesPage({ client }: { client: ApiClient }) {
  useEffect(() => { document.title = "Data sources · ERVEI"; }, []);
  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Data sources</p>
        <h1>Data sources</h1>
        <p className="sub">
          Customer accounts come from a synthetic WA electricity retail dataset: 22 files covering 5,150 customers from 1 Jul 2023 to
          30 Jun 2025. The demo has every open account, 4,380 customers: 200 chosen as testing scenarios (20 each, with fictional
          survey answers), and the other 4,180 with no survey, so all they show comes from their account. Imported by
          {" "}<code>scripts/import-utility-dataset.mts --all</code> and <code>scripts/generate-all-cases.mts</code>. The 770 closed
          accounts are left out.
        </p>
      </header>

      <section className="case-card bts-facts" aria-labelledby="ds-how">
        <h2 id="ds-how">How the data was used</h2>
        <ul className="plain history">
          <li><strong>Dates moved forward 473 days</strong> so the data ends on the app's as-of date, 16 Oct 2026. Seasons move by about 3.5 months.</li>
          <li><strong>Kept fictional:</strong> names, contact details, dates of birth and survey answers. Survey answers about a concession, life support and hardship enrolment are set from the account so they agree.</li>
          <li><strong>From the dataset:</strong> everything on the Utility account, Bills, Support history, Collections and supply, and Contact history sections, plus suburb, postcode and preferred contact channel.</li>
          <li><strong>Never used for signals or priority:</strong> future-outcome labels and intervention outcomes, which exist to train and evaluate models.</li>
        </ul>
      </section>

      <section className="case-card" aria-labelledby="ds-ai">
        <h2 id="ds-ai">Written by AI</h2>
        <p className="hint">Drafted by Claude or Gemini (whichever the server is set to) when a case or its section is opened, from the case's facts only. Each is labelled "AI draft · check before acting" on the page.</p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">What</th><th scope="col">Where it appears</th><th scope="col">Made from</th></tr></thead>
            <tbody>
              <tr><th scope="row">Suggested plan</th><td>Case page, What to do first; top of Support areas and why</td><td>Priority, flagged circumstances and their signals, solutions, contact settings</td></tr>
              <tr><th scope="row">What the signals say</th><td>Case page, Account signals section</td><td>The account and weather signals and their evidence</td></tr>
              <tr><th scope="row">Order of Solutions to offer, and each reason</th><td>Case page, What to do first (the top three) and the Solutions to offer section</td><td>The same call as the Suggested plan</td></tr>
              <tr><th scope="row">Date to act by and contact method</th><td>Solutions to offer and its Timeline</td><td>The AI picks working days and a method; the server turns them into dates and checks the method against the contact settings</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="ds-made">
        <h2 id="ds-made">Not from the data files</h2>
        <p className="hint">Not written by AI either: invented by the demo's scripts, or worked out by the app from the data.</p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">What</th><th scope="col">How it is made</th></tr></thead>
            <tbody>
              <tr><th scope="row">Names, gender, preferred name, address, phone, email</th><td>Invented by <code>scripts/generate-synthetic-cases.mjs</code> and <code>generate-all-cases.mts</code>. Phone numbers are from ranges reserved for fiction and emails use example.com. Suburb and postcode do come from the dataset.</td></tr>
              <tr><th scope="row">Dates of birth</th><td>Invented (the dataset has none); every holder is an adult.</td></tr>
              <tr><th scope="row">Survey answers</th><td>Invented for the 200 scenario cases to fit each testing scenario; answers about a concession, life support and hardship enrolment are set from the account so they agree. The other customers have none.</td></tr>
              <tr><th scope="row">Account numbers (DEMO-7xxxxx) and case IDs</th><td>Numbered by the scripts.</td></tr>
              <tr><th scope="row">Workers, case status, assignments and starting notes</th><td>Invented for the demo; changes made in the app are real and saved.</td></tr>
              <tr><th scope="row">Signals, circumstances and solutions</th><td>Worked out by the app's rules and the Flowchart file from the data.</td></tr>
              <tr><th scope="row">Priority</th><td>Worked out by the Priority model's points (see Priority model).</td></tr>
              <tr><th scope="row">Predicted risk</th><td>A statistical model trained on the monthly panel (see Risk model). Not generative AI.</td></tr>
              <tr><th scope="row">Weather outlook, act now and watch, and the funnel</th><td>Worked out by the app from the forecast and each customer's signals (see Weather outlook).</td></tr>
              <tr><th scope="row">Sample heatwave</th><td>Built into the app, used when the weather source is set to Sample heatwave: a hand-written week for each forecast town, with a three-day heatwave over the Lower West.</td></tr>
              <tr><th scope="row">Map locations</th><td>Approximate suburb centres added for the queue's map; the dataset has no coordinates. On the outlook map each forecast town sits at the average of its postcodes.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="ds-weather">
        <h2 id="ds-weather">Live data: Bureau of Meteorology</h2>
        <p className="hint">Fetched by the server every hour, matched to each customer's postcode, and used for the three weather signals and the Weather outlook. Free anonymous products, under the Bureau's copyright terms.</p>
        <p className="block-label">Weather source</p>
        <WeatherSource client={client} />
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">Product</th><th scope="col">What's in it</th><th scope="col">What is used</th></tr></thead>
            <tbody>
              <tr><th scope="row"><code>IDW14199</code></th><td>WA town forecasts: 116 towns, today plus 7 days, each tagged with its forecast district.</td><td>Daily maximum and minimum temperatures, for the Extreme heat forecast signal.</td></tr>
              <tr><th scope="row"><code>IDW13010</code></th><td>WA district forecasts for 14 districts, with fire danger ratings for each fire weather area.</td><td>The highest fire danger rating in each district, usually for tomorrow, for the Extreme fire danger forecast signal.</td></tr>
              <tr><th scope="row"><code>IDW2xxxx</code></th><td>Warnings, which only exist while active. Found by listing the Bureau's anonymous FTP folder.</td><td>Title, the districts covered (not cancelled ones) and expiry, for the Weather warning signal. Marine and sheep graziers warnings are left out.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="hint">Each dataset postcode is matched to its nearest forecast town (Perth suburbs to the nearest metro point). The server starts with the sample heatwave (set <code>WEATHER_MODE</code> to <code>live</code> or <code>off</code> to change that); a switch above lasts until the server restarts.</p>
      </section>

      <section className="case-card" aria-labelledby="ds-ewa">
        <h2 id="ds-ewa">Live data: Emergency WA</h2>
        <p className="hint">
          The Department of Fire and Emergency Services' public warnings feed (<code>api.emergency.wa.gov.au/v1/capau</code>), in the
          CAP-AU format, fetched by the server every 5 minutes. Shown on the Weather outlook map as a layer that can be switched off;
          it doesn't change any signal, priority or outlook tier.
        </p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">What's in it</th><th scope="col">What is used</th></tr></thead>
            <tbody>
              <tr><td>Every current warning in WA (bushfires, floods, storms, closures and more), each with its alert level, the area it covers as an outline or a centre point, instructions and a link.</td><td>Headline, alert level (coloured as Emergency WA does: yellow advice, orange watch and act, red emergency warning), the area's outline and centre, area description and the link to the warning. Cancelled alerts are left out.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="ds-climate">
        <h2 id="ds-climate">Climate: past and projected heat</h2>
        <p className="hint">
          Downloaded once by <code>scripts/build-climate-heat.mts</code> into <code>data/climate/heat-by-postcode.v1.json</code>, a small
          table of very hot days a year for each postcode, now and around 2050. Shown on the case page's weather card and the outlook's
          "Hotter years ahead" table. It doesn't change any signal, priority or outlook tier. ERVEI is a non-commercial project.
        </p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">Source</th><th scope="col">What is used</th><th scope="col">Licence and credit</th></tr></thead>
            <tbody>
              <tr><th scope="row">SILO (Queensland Government)</th><td>Daily maximum temperature at each postcode's location, 1995 to 2024, from its 5 km grid built from Bureau of Meteorology observations: days a year at 35°C and 40°C or more, and the average summer maximum.</td><td>CC BY 4.0. Contains SILO data from the Queensland Government, based on Bureau of Meteorology observations.</td></tr>
              <tr><th scope="row">Climate Change in Australia, CMIP6 application-ready data</th><td>Daily maximum temperature from three climate models (ACCESS-CM2, EC-Earth3, NorESM2-MM) for 2035–2064 under SSP2-4.5, a middle emissions path, scaled to AGCD observations. The change in hot days at each forecast town from 1985–2014 (the median of the three) is added to each postcode's SILO figure. Every third year is sampled.</td><td>CC BY 4.0. CSIRO, the Bureau of Meteorology and the Australian Climate Service. The projections are a guide only and not for financial decisions.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="ds-files">
        <h2 id="ds-files">Files <span className="pill">{SOURCES.length}</span></h2>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">File</th><th scope="col">Rows</th><th scope="col">What's in it</th><th scope="col">What was extracted</th><th scope="col">Left out</th></tr></thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.file}>
                  <th scope="row"><code>{s.file}</code></th>
                  <td className="num">{s.rows}</td>
                  <td>{s.contains}</td>
                  <td>{s.extracted}</td>
                  <td className="muted">{s.leftOut ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
