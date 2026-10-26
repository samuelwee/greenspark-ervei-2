// An infographic of who the customers are: how serious their situations are, what they need and which
// circumstances are behind it. Counts only; no customer is named or identifiable here.
import { useEffect, useState } from "react";
import { SUPPORT_GROUPS, SUPPORT_GROUP_COLORS } from "@greenspark/shared";
import type { ApiClient, Insights } from "../data/api";

const PRIORITY: Record<string, { label: string; color: string; note: string }> = {
  urgent: { label: "Urgent", color: "#ae2e24", note: "80+ points" },
  high: { label: "High", color: "#e2683c", note: "60 to 79" },
  moderate: { label: "Moderate", color: "#e0a030", note: "35 to 59" },
  routine: { label: "Routine", color: "#7a9cc6", note: "under 35" },
  none: { label: "Not assessed", color: "#c9ced6", note: "no priority yet" },
};
const NEED_GROUP: Record<string, { label: string; color: string; icon: string; what: string }> = {
  health: { label: "Health", color: "#b3361f", icon: "♥", what: "life support, medical cooling, illness, age, disability" },
  supply: { label: "Supply could stop", color: "#c27a12", icon: "⚡", what: "disconnected, low prepay credit, disconnection warning" },
  cost: { label: "Can't afford cooling", color: "#2f5fa7", icon: "$", what: "going without, arrears, overdue bills, fixed income" },
  isolation: { label: "Isolated", color: "#6c3fb0", icon: "◎", what: "remote area, outages, hard to reach, no internet" },
};
const RISK: Record<string, { label: string; color: string }> = {
  very_high: { label: "Very high", color: "#a32d2d" }, high: { label: "High", color: "#d85a30" },
  raised: { label: "Raised", color: "#ef9f27" }, low: { label: "Low", color: "#378ADD" }, none: { label: "No prediction", color: "#c9ced6" },
};
const SENSITIVITY_TAG: Record<string, string> = { sensitive: "Sensitive", safety: "Safety" };
const n = (v: number) => v.toLocaleString("en-AU");
const pct = (v: number, total: number) => (total ? `${Math.round((v / total) * 100)}%` : "0%");

/** A ring split into slices, drawn with stroked circle arcs. Hovering (or tabbing to) a slice shows its details in the centre. */
function Donut({ slices, total, active, onActive, caption }: {
  slices: { key: string; color: string; value: number; label: string }[]; total: number; active: string | null; onActive: (key: string | null) => void; caption: string;
}) {
  const r = 70, c = 2 * Math.PI * r;
  let offset = 0;
  const on = slices.find((x) => x.key === active) ?? null;
  return (
    <svg viewBox="0 0 200 200" className="ins-donut" role="group" aria-label={slices.map((x) => `${x.label} ${x.value}`).join(", ")}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="#eef1f4" strokeWidth="34" />
      {slices.filter((x) => x.value > 0).map((x) => {
        const len = (x.value / Math.max(1, total)) * c;
        const el = (
          <circle
            key={x.key} cx="100" cy="100" r={r} fill="none" stroke={x.color} strokeWidth={active === x.key ? 40 : 34}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)" opacity={active && active !== x.key ? 0.35 : 1}
            tabIndex={0} aria-label={`${x.label}: ${x.value}, ${pct(x.value, total)}`}
            onMouseEnter={() => onActive(x.key)} onMouseLeave={() => onActive(null)} onFocus={() => onActive(x.key)} onBlur={() => onActive(null)}
            style={{ cursor: "pointer", transition: "opacity .12s" }}
          />
        );
        offset += len;
        return el;
      })}
      <text x="100" y={on ? 84 : 98} textAnchor="middle" className="ins-donut-n">{on ? n(on.value) : n(total)}</text>
      <text x="100" y={on ? 104 : 120} textAnchor="middle" className="ins-donut-l" style={on ? { fontSize: 10 } : undefined}>{on ? on.label : caption}</text>
      {on ? <text x="100" y="122" textAnchor="middle" className="ins-donut-l">{pct(on.value, total)} of {n(total)}</text> : null}
    </svg>
  );
}

function Bars({ rows, total, color }: { rows: { key: string; label: string; count: number; color?: string; tag?: string }[]; total: number; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ol className="ins-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="ins-bar-label">{r.label}{r.tag ? <em>{r.tag}</em> : null}</span>
          <span className="ins-bar-track"><i style={{ width: `${(r.count / max) * 100}%`, background: r.color ?? color }} /></span>
          <span className="ins-bar-n"><strong>{n(r.count)}</strong> <span className="sub">{pct(r.count, total)}</span></span>
        </li>
      ))}
    </ol>
  );
}

export function InsightsPage({ client }: { client: Pick<ApiClient, "insights"> }) {
  const [d, setD] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  useEffect(() => { document.title = "Customer insights · ERVEI"; }, []);
  useEffect(() => {
    let live = true;
    client.insights?.().then((x) => { if (live) setD(x); }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Could not load the insights."); });
    return () => { live = false; };
  }, [client]);

  if (error) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="alert"><p>{error}</p></div></main>;
  if (!d) return <main id="queue" className="outlook" tabIndex={-1}><div className="empty" role="status"><p>Counting customers…</p></div></main>;

  const assessed = d.total - (d.priority.find((p) => p.label === "none")?.count ?? 0);
  const serious = (d.priority.find((p) => p.label === "urgent")?.count ?? 0) + (d.priority.find((p) => p.label === "high")?.count ?? 0);
  const multi = d.howMany.filter((h) => h.n >= 2).reduce((a, h) => a + h.count, 0);
  const maxHow = Math.max(1, ...d.howMany.map((h) => h.count));
  const groupLabel = (id: string) => SUPPORT_GROUPS.find((g) => g.id === id)!;
  // Customers with nothing specific to act on (Monitor and follow-up) are left out of this picture.
  const supportShown = d.supportGroups.filter((g) => g.id !== "monitor");
  const needSupport = supportShown.reduce((a, g) => a + g.count, 0);

  return (
    <main id="queue" className="outlook insights" tabIndex={-1}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Customer insights · counts only</p>
          <h1>Who our customers are, and what they need</h1>
          <p className="hint">A picture of every customer in the demo: how serious their situations are, what makes hot weather and bills harder for them, and which circumstances sit behind it. Synthetic data; no one is named.</p>
        </div>
      </div>

      <section className="ins-hero" aria-label="Headline numbers">
        <div><strong>{n(d.total)}</strong><span>customers</span></div>
        <div><strong>{pct(serious, assessed)}</strong><span>urgent or high priority</span></div>
        <div><strong>{pct(d.rising, d.total)}</strong><span>getting worse (rising trend)</span></div>
        <div><strong>{pct(multi, d.total)}</strong><span>have two or more circumstances</span></div>
        <div><strong>{pct(d.north, d.total)}</strong><span>live in the north, over 26°S</span></div>
      </section>

      <section className="panel ins-panel" aria-labelledby="ins-priority">
        <h2 id="ins-priority">How serious their situations are</h2>
        <p className="hint">Priority out of 100, from the circumstances and signals found on each account.</p>
        <div className="ins-stack" role="img" aria-label={d.priority.map((p) => `${PRIORITY[p.label]!.label} ${p.count}`).join(", ")}>
          {d.priority.filter((p) => p.count > 0).map((p) => <i key={p.label} style={{ flex: p.count, background: PRIORITY[p.label]!.color }} title={`${PRIORITY[p.label]!.label}: ${n(p.count)}`}>{p.count / d.total > 0.07 ? pct(p.count, d.total) : ""}</i>)}
        </div>
        <ul className="ins-legend">
          {d.priority.map((p) => <li key={p.label}><i style={{ background: PRIORITY[p.label]!.color }} /><span><strong>{PRIORITY[p.label]!.label}</strong> {n(p.count)} <span className="sub">{PRIORITY[p.label]!.note}</span></span></li>)}
        </ul>
      </section>

      <section className="panel ins-panel" aria-labelledby="ins-needs">
        <h2 id="ins-needs">What makes it harder for them</h2>
        <p className="hint">Customers with at least one recorded need in each group. One person can be in several.</p>
        <div className="ins-tiles">
          {d.needGroups.map((g) => {
            const meta = NEED_GROUP[g.group]!;
            return (
              <div key={g.group} className="ins-tile" style={{ borderTopColor: meta.color }}>
                <span className="ins-tile-icon" style={{ background: meta.color }} aria-hidden="true">{meta.icon}</span>
                <strong style={{ color: meta.color }}>{pct(g.count, d.total)}</strong>
                <h3>{meta.label}</h3>
                <span className="sub">{n(g.count)} customers</span>
                <span className="ins-tile-what">{meta.what}</span>
              </div>
            );
          })}
        </div>
        <h3 className="ins-sub">The most common needs</h3>
        <Bars total={d.total} color="#2f5fa7" rows={d.needs.map((x) => ({ key: x.id, label: x.label, count: x.count, color: NEED_GROUP[x.group]?.color }))} />
      </section>

      <div className="ins-two">
        <section className="panel ins-panel" aria-labelledby="ins-groups">
          <h2 id="ins-groups">What support they need first</h2>
          <p className="hint">Each customer's main support group, for customers who need support. Hover a slice for details.</p>
          <div className="ins-donut-wrap">
            <Donut total={needSupport} caption="needing support" active={hoverGroup} onActive={setHoverGroup} slices={supportShown.map((g) => ({ key: g.id, color: SUPPORT_GROUP_COLORS[g.id as keyof typeof SUPPORT_GROUP_COLORS].strong, value: g.count, label: groupLabel(g.id).label }))} />
            <ul className="ins-legend is-col">
              {supportShown.map((g) => (
                <li key={g.id} className={hoverGroup === g.id ? "is-on" : undefined} onMouseEnter={() => setHoverGroup(g.id)} onMouseLeave={() => setHoverGroup(null)}><i style={{ background: SUPPORT_GROUP_COLORS[g.id as keyof typeof SUPPORT_GROUP_COLORS].strong }} /><span><strong>{groupLabel(g.id).label}</strong> {n(g.count)} <span className="sub">{pct(g.count, needSupport)}</span></span></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="panel ins-panel" aria-labelledby="ins-risk">
          <h2 id="ins-risk">Chance of hardship, next 90 days</h2>
          <p className="hint">The model's band for each customer, against the average for them.</p>
          <ol className="ins-columns" aria-label="Customers by chance of hardship">
            {d.risk.map((r) => {
              const max = Math.max(1, ...d.risk.map((x) => x.count));
              return (
                <li key={r.id}>
                  <span className="ins-col-n">{n(r.count)}</span>
                  <i style={{ height: `${Math.max(3, (r.count / max) * 100)}%`, background: RISK[r.id]!.color }} />
                  <span className="ins-col-l">{RISK[r.id]!.label}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section className="panel ins-panel" aria-labelledby="ins-circ">
        <h2 id="ins-circ">The circumstances behind it</h2>
        <p className="hint">The circumstances the flowchart flags most often, with the area of life each belongs to.</p>
        <div className="ins-two ins-flush">
          <div>
            <h3 className="ins-sub">Most common circumstances</h3>
            <Bars total={d.total} color="#1f7a50" rows={d.circumstances.map((c) => ({ key: c.id, label: c.label, count: c.count, tag: SENSITIVITY_TAG[c.sensitivity], color: c.sensitivity === "safety" ? "#a32d2d" : c.sensitivity === "sensitive" ? "#b3361f" : undefined }))} />
          </div>
          <div>
            <h3 className="ins-sub">By area of life</h3>
            <Bars total={d.total} color="#08677e" rows={d.areas.map((a) => ({ key: a.id, label: a.label, count: a.count }))} />
            <h3 className="ins-sub">How many circumstances each customer has</h3>
            <ol className="ins-columns is-short" aria-label="Customers by number of circumstances">
              {d.howMany.map((h) => (
                <li key={h.n}>
                  <span className="ins-col-n">{n(h.count)}</span>
                  <i style={{ height: `${Math.max(3, (h.count / maxHow) * 100)}%`, background: "#1f7a50" }} />
                  <span className="ins-col-l">{h.n === 6 ? "6+" : h.n}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className="ins-note"><strong>{n(d.sensitive)}</strong> customers have a sensitive circumstance and <strong>{n(d.safety)}</strong> a safety circumstance. Both need a strong signal to be flagged, and safety circumstances always go to trained staff.</p>
      </section>
    </main>
  );
}
