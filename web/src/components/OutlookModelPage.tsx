import { useEffect } from "react";
import { HEAT_THRESHOLD, HOT_MARGIN, SENSITIVITY, SENSITIVITY_GROUPS, WEATHER_SIGNAL_NAMES, type SensitivityGroup } from "@greenspark/shared";

const GROUPS = Object.keys(SENSITIVITY_GROUPS) as SensitivityGroup[];
const SIGNAL_LABEL: Record<string, string> = Object.fromEntries(Object.keys(SENSITIVITY).map((id) => [id, id.startsWith("ask_") ? "Customer told us" : "Account"]));

/** How the Weather outlook and its funnel pick out the customers to contact before the weather hits. */
export function OutlookModelPage() {
  useEffect(() => { document.title = "Weather outlook model · ERVEI"; }, []);
  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Weather outlook</p>
        <h1>Weather outlook</h1>
        <p className="sub">
          The home page looks a week ahead. It matches the Bureau of Meteorology's forecast for each customer's area with what we know
          about them, to find the people the weather could hurt before it arrives. The Funnel page shows how that narrows everyone down
          to the customers to call first. This page explains the rules.
        </p>
      </header>

      <section className="case-card bts-facts" aria-labelledby="om-weather">
        <h2 id="om-weather">1. The weather coming</h2>
        <ul className="plain history">
          <li><strong>Where:</strong> each customer's postcode is matched to its nearest Bureau forecast town, and that town's district. Customers in postcodes with no forecast town are left out of the outlook.</li>
          <li><strong>Extreme heat</strong> (severity 3): a forecast maximum of {HEAT_THRESHOLD.south}°C or more in the next 7 days, or {HEAT_THRESHOLD.north}°C north of the 26th parallel, where 40°C is routine. 3°C or more over that limit is severe (4).</li>
          <li><strong>Hot day</strong> (severity 1): within {HOT_MARGIN}°C of the extreme-heat limit. Not dangerous for most people, but it is for someone on life support or whose power could stop.</li>
          <li><strong>Fire danger</strong> (3): an Extreme rating for the district; Catastrophic is severe (4). The free forecast usually rates tomorrow only.</li>
          <li><strong>Warning</strong> (3): an active Bureau warning for the district about heat, severe weather or storms, fire weather, bushfire, cyclone, flood or damaging wind. Marine and sheep graziers warnings are left out.</li>
          <li><strong>A customer's exposure</strong> is the worst severity in their week, from 0 (nothing) to 4. These are the same forecasts behind the case page's weather signals ({Object.values(WEATHER_SIGNAL_NAMES).join(", ")}).</li>
        </ul>
      </section>

      <section className="case-card" aria-labelledby="om-needs">
        <h2 id="om-needs">2. Why it could hurt them</h2>
        <p className="hint">Signals from the account, and from what the customer has told us in the survey or on calls, that make hot or dangerous weather harder to cope with. Each has a weight; a customer's need is the total.</p>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">Need</th><th scope="col">Signal</th><th scope="col">From</th><th scope="col" className="num">Weight</th></tr></thead>
            <tbody>
              {GROUPS.flatMap((g) => Object.entries(SENSITIVITY).filter(([, s]) => s.group === g).map(([id, s], i) => (
                <tr key={id}>
                  {i === 0 ? <th scope="rowgroup" rowSpan={Object.values(SENSITIVITY).filter((x) => x.group === g).length}>{SENSITIVITY_GROUPS[g]}</th> : null}
                  <td>{s.label}</td><td className="muted">{SIGNAL_LABEL[id]}</td><td className="num">{s.weight}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card bts-facts" aria-labelledby="om-tiers">
        <h2 id="om-tiers">3. Act now and watch</h2>
        <ul className="plain history">
          <li><strong>Act now:</strong> dangerous weather (exposure 3 or more) and a health or supply need. Or any hot day for someone on life support, with a medical need for cooling or medical equipment, or whose supply has stopped or whose prepay credit is running out.</li>
          <li><strong>Watch:</strong> any hot or dangerous weather and a need that adds up: a weight of 3 or more, or any health or supply need. A concession card alone doesn't count. Or dangerous weather and a predicted 90-day risk at least 4× the average (see Risk model).</li>
          <li><strong>Order:</strong> act now first, then by score: exposure × (1 + needs' weight, up to 15), plus 20 × the predicted chance of any harm. The list shows the weather coming and when, the top three needs, the predicted risk and the case's priority.</li>
          <li><strong>Everyone else</strong> is counted on the page but not listed.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="om-funnel">
        <h2 id="om-funnel">4. The funnel</h2>
        <ul className="plain history">
          <li><strong>All customers:</strong> everyone with a Bureau forecast for their area.</li>
          <li><strong>Hot or dangerous weather:</strong> exposure of 1 or more this week.</li>
          <li><strong>…and a reason it could hurt them:</strong> any need in the table above, or a high predicted risk.</li>
          <li><strong>On the outlook:</strong> act now or watch.</li>
          <li><strong>Act now.</strong> Each stage is part of the one above, so the funnel always narrows. "See the act-now list" opens the outlook filtered to them.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="om-behind">
        <h2 id="om-behind">Behind the scenes</h2>
        <ul className="plain history">
          <li><strong>One request,</strong> <code>GET /api/outlook</code>, returns the week for each forecast town (with its map position, hazards and counts), each day's hottest place and exposed customers, the active warnings, the totals for the tiles and funnel, and every act-now and watch customer. The rules live in <code>shared/src/outlook.ts</code>.</li>
          <li><strong>Forecast:</strong> the server's weather source, switched in Demo settings: the Bureau's live data, refreshed hourly, or the sample heatwave, a made-up week with a three-day heatwave over the Lower West. Live data is usually quiet unless hot weather is coming.</li>
          <li><strong>Needs</strong> come from the short summary of signals stored with each person, so the outlook never loads whole utility accounts.</li>
          <li><strong>The map</strong> places each forecast town at the average of its postcodes, coloured by its worst weather and sized by its act-now and watch customers.</li>
          <li><strong>Emergency WA warnings</strong> are a second map layer: the current DFES warnings, fetched by the server every 5 minutes (<code>GET /api/emergency</code>) and drawn as their areas in Emergency WA's colours. They are for awareness only and don't change who is listed. Either layer can be switched off; the choice is remembered in this browser.</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="om-other">
        <h2 id="om-other">Not the same as priority or predicted risk</h2>
        <ul className="plain history">
          <li><strong>Outlook:</strong> could this week's weather hurt them? The next 7 days.</li>
          <li><strong>Predicted risk:</strong> how likely is harm to their account in the next 90 days, from account history? It ignores the weather.</li>
          <li><strong>Priority:</strong> how serious is their situation right now? It orders the case queue, and weather can add to it.</li>
          <li>So a customer can be urgent but not on the outlook (serious hardship, mild weather), or act now but routine priority (on life support, healthy finances, a heatwave coming).</li>
        </ul>
      </section>

      <section className="case-card bts-facts" aria-labelledby="om-trust">
        <h2 id="om-trust">How much to trust it</h2>
        <ul className="plain history">
          <li><strong>A forecast is not an event.</strong> The outlook says who to check on, not that anything has happened.</li>
          <li><strong>Needs are only what we know.</strong> Someone with no signals may still be vulnerable; someone flagged may be fine. Check with the customer.</li>
          <li><strong>One forecast town covers a wide area,</strong> especially outside Perth, so local conditions can differ.</li>
          <li><strong>All customers are fictional</strong>, from the synthetic dataset.</li>
        </ul>
      </section>
    </main>
  );
}
