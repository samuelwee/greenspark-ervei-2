import { detectAccountSignals } from "../domain/types";
import type { ApiClient, CaseItem, Catalog, SupportPlan } from "../data/api";
import { CaseWeather, OutlookBanner } from "./CaseWeather";
import { PlanCosts, UsageChart } from "./AccountDetails";
import { paragraphs } from "./paragraphs";
import { OUTCOME_LABEL, OUTCOME_ORDER, band, percent } from "./predictionText";

const money = (n: number) => `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
const PRIORITY_COLOR: Record<string, string> = { urgent: "var(--urgent)", high: "var(--high)", moderate: "var(--moderate)", routine: "var(--routine)" };

/** A half-circle gauge for a score out of 100. */
/** The priority label as when to contact the customer. */
const CONTACT_BY: Record<string, string> = { urgent: "Today", high: "This week", moderate: "Soon", routine: "Monitor" };

function Gauge({ score, color, label }: { score: number; color: string; label: string }) {
  const r = 60, len = Math.PI * r;
  return (
    <svg viewBox="0 0 140 84" className="vis-gauge" role="img" aria-label={`${label}: ${score} out of 100`}>
      <path d="M10 76 A60 60 0 0 1 130 76" fill="none" stroke="var(--border)" strokeWidth="12" strokeLinecap="round" />
      <path d="M10 76 A60 60 0 0 1 130 76" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(len * score) / 100} ${len}`} />
      <text x="70" y="70" textAnchor="middle" className="vis-gauge-n">{score}</text>
    </svg>
  );
}

/** A card's link to the section with the full detail. */
function More({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="link-btn vis-more" onClick={onClick}>{label} →</button>;
}

/**
 * One case at a glance: how urgent, what's going on, what to offer, in pictures and few words. Each card links to
 * the section with the full detail (`onOpen` takes the section's id).
 */
export function CaseGlance({ item, data, plan, planFailed, onOpen, client }: { item: CaseItem; data: Catalog; plan: SupportPlan | null; planFailed: boolean; onOpen: (section: string) => void; client?: Pick<ApiClient, "emergency" | "forecastTowns"> }) {
  const c = item.case, person = item.person, a = person?.account ?? null;
  const priority = c.modelAssessment.priority;
  const overdue = a?.monthly.at(-1)?.overdue ?? 0;
  const signals = [...(a ? detectAccountSignals(a, data.asOf) : []), ...(item.weatherSignals ?? [])];
  const circ = (id: string) => data.circumstances.find((x) => x.id === id);
  const areas = data.supportAreas
    .map((area) => ({ area, items: c.circumstances.filter((x) => circ(x.circumstanceId)?.supportAreaId === area.id) }))
    .filter((g) => g.items.length);
  const order = plan?.order?.length ? plan.order : c.recommendations.map((r) => ({ id: r.recommendationId, reason: "", due: undefined, method: undefined }));
  const top = order.slice(0, 3).map((o) => ({ ...o, label: data.recommendations.find((r) => r.id === o.id)?.label ?? o.id }));
  const facts: { icon: string; label: string; tone: "bad" | "warn" | "ok" | "info" }[] = a ? [
    { icon: a.supplyStatus === "disconnected" ? "⏻" : "⚡", label: a.supplyStatus === "disconnected" ? "Disconnected" : "Power on", tone: a.supplyStatus === "disconnected" ? "bad" : "ok" },
    { icon: "$", label: overdue > 0 ? `${money(overdue)} overdue` : "Nothing overdue", tone: overdue > 0 ? "warn" : "ok" },
    ...(a.lifeSupport ? [{ icon: "♥", label: "Life support", tone: "bad" as const }] : []),
    ...(a.medicalCoolingSubsidy ? [{ icon: "❄", label: "Medical cooling", tone: "warn" as const }] : []),
    { icon: "▣", label: a.concession.status === "active" ? "Concession on file" : "No concession", tone: a.concession.status === "active" ? "info" : "warn" },
    { icon: "◷", label: a.hardshipProgram.status === "active" ? "In hardship program" : "Not in hardship program", tone: a.hardshipProgram.status === "active" ? "info" : "warn" },
    ...(a.plan.type === "prepaid" ? [{ icon: "▤", label: "Prepay meter", tone: "info" as const }] : []),
    ...(a.interpreterRequired ? [{ icon: "✆", label: "Interpreter needed", tone: "info" as const }] : []),
  ] : [];

  return (
    <div className="vis-grid">
      <div className="vis-top vis-wide">
      {item.forecast?.outlook ? (
        <section className="case-card vis-card" aria-labelledby="vis-outlook">
          <h2 id="vis-outlook">Weather outlook this week</h2>
          <p className="vis-what">Whether this week's weather could hurt them, given what we know about them.</p>
          <OutlookBanner f={item.forecast} />
          <button type="button" className="link-btn vis-more" onClick={() => document.getElementById("vis-wx")?.scrollIntoView({ behavior: "smooth", block: "start" })}>The forecast and warnings →</button>
        </section>
      ) : null}
      <section className="case-card vis-card" aria-labelledby="vis-pri">
        <h2 id="vis-pri">Contact by</h2>
        <p className="vis-what">When to reach them, from how serious their situation is now.</p>
        {priority ? (
          <>
            <Gauge score={priority.score} color={PRIORITY_COLOR[priority.label] ?? "var(--muted)"} label="Priority" />
            <p className="vis-big" style={{ color: PRIORITY_COLOR[priority.label] }}>{CONTACT_BY[priority.label] ?? priority.label}</p>
            <p className="hint">{c.modelAssessment.trend === "rising" ? "↑ Getting worse" : "→ Steady"}</p>
          </>
        ) : <p className="muted">No priority yet.</p>}
        <More label="How the priority is worked out" onClick={() => onOpen("priority")} />
      </section>

      <section className="case-card vis-card" aria-labelledby="vis-risk">
        <h2 id="vis-risk">Chance of hardship, next 90 days</h2>
        <p className="vis-what">Predicted from their account history. Ignores the weather.</p>
        {item.prediction ? (
          <ul className="vis-bars vis-plain">
            {OUTCOME_ORDER.map((id) => {
              const o = item.prediction!.outcomes[id];
              if (!o) return null;
              const b = band(o.probability, o.baseRate);
              return (
                <li key={id} className={`pred-${b.id}`}>
                  <span>{OUTCOME_LABEL[id]}</span>
                  <strong title={`${percent(o.probability)} chance`}>{b.text}</strong>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No prediction for this customer.</p>}
        {item.prediction ? <More label="Chance of hardship" onClick={() => onOpen("hardship")} /> : null}
      </section>

      </div>

      <section className="case-card vis-card vis-wide" aria-labelledby="vis-facts">
        <h2 id="vis-facts">The account</h2>
        {facts.length ? (
          <ul className="vis-facts">{facts.map((f) => <li key={f.label} className={`vis-${f.tone}`}><span className="vis-icon" aria-hidden="true">{f.icon}</span>{f.label}</li>)}</ul>
        ) : <p className="muted">No utility account.</p>}
        <More label="Customer and account details" onClick={() => onOpen("customer")} />
      </section>

      <CaseWeather item={item} client={client} />

      <section className="case-card vis-card vis-wide" aria-labelledby="vis-going">
        <h2 id="vis-going">What's going on</h2>
        {areas.length ? (
          <div className="vis-areas">
            {areas.map(({ area, items }) => (
              <div key={area.id} className="vis-area">
                <p className="block-label">{area.label}</p>
                <ul className="vis-chips">{items.map((x) => { const d = circ(x.circumstanceId); return <li key={x.circumstanceId} className={d?.sensitivity === "safety" ? "vis-safety" : d?.sensitivity === "sensitive" ? "vis-sensitive" : undefined}>{d?.label ?? x.circumstanceId}</li>; })}</ul>
              </div>
            ))}
          </div>
        ) : <p className="muted">Nothing flagged.</p>}
        <p className="hint">{signals.length} warning sign{signals.length === 1 ? "" : "s"} in the account{signals.length ? `: ${signals.slice(0, 4).map((s) => s.name).join(", ")}${signals.length > 4 ? "…" : ""}` : ""}.</p>
        <span className="vis-links">
          <More label="Support areas and why" onClick={() => onOpen("support")} />
          {a ? <More label="Account signals" onClick={() => onOpen("signals")} /> : null}
        </span>
      </section>

      <section className="case-card vis-card vis-wide" aria-labelledby="vis-do">
        <h2 id="vis-do">What to do first</h2>
        {plan?.text ? <div className="vis-plan"><p className="vis-plan-label"><span aria-hidden="true">✦</span> AI summary</p>{paragraphs(plan.text).map((t, i) => <p key={i}>{t}</p>)}</div> : planFailed ? <p className="muted">The AI plan isn't available right now; these are the standard first solutions.</p> : c.circumstances.length ? <p className="muted">Drafting a support plan…</p> : null}
        {top.length ? (
          <ol className="vis-steps">
            {top.map((s, i) => (
              <li key={s.id}>
                <span className="rank-num">{i + 1}</span>
                <div><strong>{s.label}</strong>{s.due ? <span className="sub">By {new Date(`${s.due}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}{s.method ? ` · ${({ phone: "phone call", sms: "SMS", email: "email", letter: "letter" } as Record<string, string>)[s.method]}` : ""}</span> : null}</div>
              </li>
            ))}
          </ol>
        ) : <p className="muted">No solutions suggested.</p>}
        {plan ? <p className="hint">AI summary · check before acting.</p> : null}
        {c.recommendations.length ? <More label={`All ${c.recommendations.length} solutions to offer`} onClick={() => onOpen("solutions")} /> : null}
      </section>

      {a?.usage.length ? (
        <>
          <section className="case-card vis-card" aria-labelledby="vis-use">
            <h2 id="vis-use">Electricity use</h2>
            <UsageChart usage={a.usage.slice(0, -1)} />
            <More label={a.prepay ? "Prepaid top-ups" : "Bills"} onClick={() => onOpen("bills")} />
          </section>
          {a.usage.slice(0, -1).at(-1)?.kWh ? (
            <section className="case-card vis-card" aria-labelledby="vis-plans">
              <h2 id="vis-plans">Plan comparison</h2>
              <PlanCosts account={a} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
