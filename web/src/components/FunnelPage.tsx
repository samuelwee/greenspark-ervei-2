import { useEffect, useState } from "react";
import type { ApiClient, Outlook } from "../data/api";

type Ready = Extract<Outlook, { available: true }>;

/** Each stage of the funnel, from every customer down to the ones to call first. */
function stages(t: Ready["totals"]) {
  return [
    // Customers in postcodes without a forecast town are left out, so "all" is everyone the forecast covers.
    { id: "all", label: "All customers", count: t.covered, note: "Every customer with a Bureau forecast for their area" },
    { id: "exposed", label: "Hot or dangerous weather", count: t.exposed, note: "A hot day, extreme heat, extreme fire danger or a warning this week" },
    { id: "vulnerable", label: "…and a reason it could hurt them", count: t.vulnerable, note: "A health, supply, cost or isolation need, or a high chance of hardship" },
    { id: "listed", label: "On the outlook", count: t.act + t.watch, note: "Act now or watch: needs that add up for the weather coming" },
    { id: "act", label: "Act now", count: t.act, note: "Dangerous weather and a health or supply need, or a critical need on any hot day" },
  ];
}

const COLORS = ["#7a9cc6", "#e0a030", "#e2833c", "#d9622f", "#ae2e24"];
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10}%` : "–");

/** A funnel from every customer to the ones this week's forecast says to contact first. */
export function FunnelPage({ client, navigate }: { client: Pick<ApiClient, "outlook">; navigate: (to: string) => void }) {
  const [data, setData] = useState<Outlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!client.outlook) { setError("The weather outlook isn't available on this server."); return; }
    let current = true;
    setError(null);
    client.outlook().then((d) => { if (current) setData(d); }, (e: unknown) => { if (current) setError(e instanceof Error ? e.message : "Could not load the outlook."); });
    return () => { current = false; };
  }, [client, retry]);
  useEffect(() => { document.title = "Outlook funnel · ERVEI"; }, []);

  if (error || !data || !data.available) {
    return (
      <main id="queue" className="outlook" tabIndex={-1}>
        {error ? <div className="empty" role="alert"><h1>We couldn’t load the funnel</h1><p>{error}</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div>
          : !data ? <div className="empty" role="status"><p>Loading the forecast…</p></div>
          : <div className="empty"><h1>No forecast yet</h1><p>Choose a weather source in Demo settings (the gear, top right).</p><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>Try again</button></div>}
      </main>
    );
  }

  const list = stages(data.totals);
  const top = Math.max(1, list[0]!.count);
  // Widths follow the counts, with a floor so the narrowest stages stay readable.
  const width = (n: number) => Math.max(14, (n / top) * 100);

  return (
    <main id="queue" className="outlook" tabIndex={-1}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Weather outlook · next 7 days</p>
          <h1>From every customer to the ones to call first</h1>
          <p className="hint">How this week’s forecast narrows {list[0]!.count.toLocaleString()} customers down to the ones to contact before the weather hits.</p>
        </div>
        <div className="outlook-source">
          {data.demo ? null : <span className="demo-pill">Live Bureau forecast</span>}
        </div>
      </div>

      <section className="panel funnel-panel" aria-labelledby="funnel-title">
        <div className="panel-head"><h2 id="funnel-title">Outlook funnel</h2></div>
        <ol className="funnel">
          {list.map((s, i) => {
            const w = width(s.count);
            const next = list[i + 1] ? width(list[i + 1]!.count) : w * 0.8;
            const inset = ((w - Math.min(w, next)) / 2 / w) * 100;
            const prev = list[i - 1];
            return (
              <li key={s.id} className="funnel-row">
                <div className="funnel-track" aria-hidden="true">
                  <div className="funnel-bar" style={{ width: `${w}%`, background: COLORS[i], clipPath: `polygon(0 0, 100% 0, ${100 - inset}% 100%, ${inset}% 100%)` }}>
                    <span>{s.count.toLocaleString()}</span>
                  </div>
                </div>
                <div className="funnel-label">
                  <strong>{s.label}</strong>
                  <span className="sub">{s.note}</span>
                  <span className="sub">{prev ? `${pct(s.count, prev.count)} of the stage above · ${(prev.count - s.count).toLocaleString()} drop out · ` : ""}{pct(s.count, top)} of all customers</span>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="pager">
          <span>{data.totals.watch.toLocaleString()} more are on watch.</span>
          <span>
            <button type="button" className="btn btn-small btn-primary" onClick={() => navigate("/?tier=act")}>See the act-now list</button>{" "}
            <button type="button" className="btn btn-small" onClick={() => navigate("/")}>Back to the outlook</button>
          </span>
        </div>
      </section>
    </main>
  );
}
