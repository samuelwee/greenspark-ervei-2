import { useEffect, useState } from "react";
import type { ApiClient, CaseItem, RiskModelCard } from "../data/api";
import { accountHref, isModifiedClick, RISK_MODEL_PATH } from "../route";
import { OUTCOME_LABEL, OUTCOME_ORDER, band, factorLabel, factorValue, percent, rank } from "./predictionText";

/** One customer's 90-day risk predictions, on their own page. */
export function PredictionsPage({ client, accountNumber, navigate }: { client: ApiClient; accountNumber: string; navigate: (to: string) => void }) {
  const [item, setItem] = useState<CaseItem | null>(null);
  const [model, setModel] = useState<RiskModelCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItem(null); setError(null);
    client.account(accountNumber).then((i) => live && setItem(i), (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load this customer."));
    client.riskModel?.().then((m) => live && setModel(m), () => undefined);
    return () => { live = false; };
  }, [client, accountNumber]);
  const name = item?.person?.displayName ?? accountNumber;
  useEffect(() => { document.title = `Predictions · ${name} · ERVEI`; }, [name]);
  const go = (to: string) => (e: React.MouseEvent) => { if (isModifiedClick(e)) return; e.preventDefault(); navigate(to); };

  if (error) return <main id="queue" className="bts-page" tabIndex={-1}><div className="empty" role="alert"><h1>We couldn’t load this customer</h1><p>{error}</p></div></main>;
  if (!item) return <main id="queue" className="bts-page" tabIndex={-1}><div className="empty" role="status"><p>Loading predictions…</p></div></main>;
  const p = item.prediction ?? null;
  const caseHref = accountHref(accountNumber);

  return (
    <main id="queue" className="bts-page predictions-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">Predictions · {accountNumber}</p>
        <h1>{name}</h1>
        <p className="sub">
          How likely each harm is in the next {p?.horizonDays ?? 90} days, from the risk model. <a href={caseHref} onClick={go(caseHref)}>Back to the case</a>
        </p>
      </header>

      {!p ? (
        <section className="case-card"><p className="muted">No prediction for this customer: the model only scores accounts in the dataset's monthly records.</p></section>
      ) : (
        <>
          <section className="pred-grid" aria-label="Predicted outcomes">
            {OUTCOME_ORDER.map((id) => {
              const o = p.outcomes[id];
              if (!o) return null;
              const base = o.baseRate ?? model?.model.outcomes[id]?.test.baseRate ?? null;
              const b = band(o.probability, base);
              return (
                <article key={id} className={`case-card pred-card pred-${b.id}`}>
                  <h2>{OUTCOME_LABEL[id]}</h2>
                  <p className="pred-band">{b.text}</p>
                  <p className="pred-prob"><strong>{percent(o.probability)}</strong> chance in {p.horizonDays} days</p>
                  <div className="pred-meter" aria-hidden="true"><span style={{ width: `${Math.max(2, o.percentile)}%` }} /></div>
                  <p className="hint">{rank(o.percentile)}{base ? ` · on average ${percent(base)}` : ""}{base && o.probability > base * 1.5 ? `, so about ${Math.round(o.probability / base)}× the average` : ""}</p>
                </article>
              );
            })}
          </section>

          <section className="case-card" aria-labelledby="pred-why">
            <h2 id="pred-why">What raises the risk</h2>
            {!p.outcomes.any_adverse || band(p.outcomes.any_adverse.probability, p.outcomes.any_adverse.baseRate).id === "low" || !p.factors.length ? (
              <p className="muted">Nothing stands out: this customer looks like most others.</p>
            ) : (
              <>
                <p className="hint">The three things in this customer's latest month that add most to "any of these harms", compared with an average customer.</p>
                <ol className="pred-factors">
                  {p.factors.map((f) => (
                    <li key={f.id}><strong>{factorLabel(f)}</strong>{factorValue(f) ? <span className="sub">{factorValue(f)}</span> : null}</li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <section className="case-card bts-facts" aria-labelledby="pred-use">
            <h2 id="pred-use">Using these predictions</h2>
            <ul className="plain history">
              <li><strong>A reason to reach out sooner, never a penalty.</strong> A high risk means offering help early: a call, a payment plan, the hardship program. It must never mean stricter collections.</li>
              <li><strong>A likelihood, not a certainty.</strong> Most customers with a high score will be fine, and some with a low score won't. Check the case before acting.</li>
              <li><strong>Based on the account as of {p.sourceMonthEnd === "2025-06-30" ? "16 Oct 2026" : p.sourceMonthEnd},</strong> the data's latest month. It doesn't know about anything since, or about what the customer has told us in the survey.</li>
              <li><strong>Trained on synthetic data.</strong> The model learned from a made-up dataset, so its accuracy says how it would work, not how well it would work on real customers. <a href={RISK_MODEL_PATH} onClick={go(RISK_MODEL_PATH)}>How the model works</a></li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

/** A compact version for the case page, linking to the full predictions page. */
export function RiskCard({ item, accountNumber, navigate }: { item: CaseItem; accountNumber: string | null; navigate: (to: string) => void }) {
  const p = item.prediction;
  if (!p || !accountNumber) return null;
  const href = `${accountHref(accountNumber)}/predictions`;
  return (
    <section className="case-card" aria-labelledby="ov-risk">
      <h3 id="ov-risk">Chance of hardship <span className="sim">next {p.horizonDays} days · model</span></h3>
      <ul className="pred-mini">
        {OUTCOME_ORDER.map((id) => {
          const o = p.outcomes[id];
          if (!o) return null;
          const b = band(o.probability, o.baseRate);
          return <li key={id}><span>{OUTCOME_LABEL[id]}</span><span className={`pred-pill pred-${b.id}`}>{b.text} · {percent(o.probability)}</span></li>;
        })}
      </ul>
      <a href={href} onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); navigate(href); }}>See the predictions and what drives them</a>
    </section>
  );
}
