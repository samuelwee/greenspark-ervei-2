// The customers to contact, one row each, with their week as a strip of coloured days. Rows arrive already sorted
// by when the weather reaches them, so the first-hazard markers step across the grid from left to right.
import { SENSITIVITY } from "@greenspark/shared";
import type { OutlookCustomer, OutlookTown } from "../data/api";
import { accountHref, isModifiedClick } from "../route";
import { band, percent } from "./predictionText";
import { GROUP_LABEL, HAZARD_LABEL, dayDate, dayName, hazardColor } from "./outlookText";

/** When to contact a customer comes from the 7-day outlook, not from their current priority score: a warning in force or a hazard today is Today, then by how many days until the first hot or dangerous day. */
export const CONTACT_BY = ["Today", "This week", "Soon", "Monitor"] as const;
export const CONTACT_BADGE = ["urgent", "high", "moderate", "routine"] as const;
const CONTACT_NOTE = ["Warning in force, or a hazard today", "First hazard in 1 to 3 days", "First hazard in 4 or more days", "No hot or dangerous day forecast"] as const;
export function contactRank(c: { kinds: string[]; firstDate: string | null }, today: string): number {
  if (c.kinds.includes("warning")) return 0;
  if (!c.firstDate) return 3;
  const days = Math.round((Date.parse(`${c.firstDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? 0 : days <= 3 ? 1 : 2;
}

/** Why a customer sits where they do in the list, for the hover on their name. */
function whyHere(c: OutlookCustomer, rank: number, today: string): string {
  const points = Math.min(15, c.sensitivity.reduce((n, x) => n + (SENSITIVITY[x.id]?.weight ?? 0), 0));
  const hardship = c.risk ? 20 * c.risk.probability : 0;
  return [
    "Why they are here",
    `Contact by: ${CONTACT_BY[rank]} (${CONTACT_NOTE[rank].toLowerCase()})`,
    `First hot or dangerous day: ${c.firstDate ? (c.firstDate === today ? "today" : `${dayName(c.firstDate)} ${dayDate(c.firstDate)}`) : "none forecast"}`,
    `Outlook group: ${c.tier === "act" ? "Act now" : c.tier === "watch" ? "Watch" : "Not listed"}`,
    `Outlook score ${c.score} = weather ${c.exposure} × (1 + needs ${points}) + chance of hardship ${hardship.toFixed(1)}`,
    "Order: contact by, then first hazard day, then act now before watch, then outlook score.",
  ].join("\n");
}

const RISK_COLOR: Record<string, string> = { low: "#378ADD", raised: "#EF9F27", high: "#D85A30", very_high: "#A32D2D" };

export function OutlookWeekList({ rows, towns, dates, today, navigate }: {
  rows: OutlookCustomer[]; towns: Map<string, OutlookTown>; dates: string[]; today: string; navigate: (to: string) => void;
}) {
  let lastRank = -1;
  return (
    <div className="week-list" role="table" aria-label="Customers to contact, soonest weather first">
      <div className="week-key" aria-hidden="true">
        <span><i style={{ background: "#eef1f4" }} />No hazard</span>
        <span><i style={{ background: hazardColor(1) }} />Hot day</span>
        <span><i style={{ background: hazardColor(3) }} />Dangerous</span>
        <span><i style={{ background: hazardColor(4) }} />Severe</span>
        <span><i className="week-key-first" />First hazard day</span>
        <span>! warning in force</span>
      </div>
      <div className="week-row week-head" role="row">
        <span role="columnheader">Customer</span>
        <span role="columnheader">Needs</span>
        <div className="week-days">{dates.map((d) => <span key={d} role="columnheader" className="week-day">{dayName(d)}</span>)}</div>
        <span role="columnheader">Chance of hardship</span>
      </div>
      {rows.map((c) => {
        const rank = contactRank(c, today), town = towns.get(c.townId), b = c.risk ? band(c.risk.probability, c.risk.baseRate) : null;
        const heading = rank !== lastRank ? <p key={`g${rank}`} className="week-group" role="presentation"><strong>{CONTACT_BY[rank]}</strong> <span className="sub">{CONTACT_NOTE[rank]}</span></p> : null;
        lastRank = rank;
        const warned = c.kinds.includes("warning"), firstDay = c.firstDate ?? (warned ? today : null);
        return (
          <div key={c.personId} className="week-block">
            {heading}
            <div className="week-row week-person" role="row" onClick={() => c.accountNumber && navigate(accountHref(c.accountNumber))}>
              <div role="cell" title={whyHere(c, rank, today)}>
                {c.accountNumber ? <a className="name-link" href={accountHref(c.accountNumber)} onClick={(e) => { e.stopPropagation(); if (isModifiedClick(e)) return; e.preventDefault(); navigate(accountHref(c.accountNumber!)); }}>{c.displayName}</a> : <strong>{c.displayName}</strong>}
                <span className="sub">{c.suburb}</span>
              </div>
              <div role="cell">
                <span className="need-chips week-needs">
                  {c.sensitivity.slice(0, 3).map((s) => <span key={s.id} className={`need need-${s.group}`} title={GROUP_LABEL[s.group]}>{s.label}</span>)}
                  {c.sensitivity.length > 3 ? <span className="need need-more">+{c.sensitivity.length - 3}</span> : null}
                  {!c.sensitivity.length ? <span className="sub">High chance of hardship</span> : null}
                </span>
              </div>
              <div className="week-days">{dates.map((d) => {
                const hazards = (town?.hazards ?? []).filter((h) => h.date === d && h.kind !== "warning");
                const worst = hazards.reduce((a, h) => Math.max(a, h.severity), 0);
                const label = hazards.length ? hazards.map((h) => h.text || HAZARD_LABEL[h.kind]).join(", ") : "No hazard";
                return <span key={d} role="cell" data-day={dayName(d)} className={`week-cell${d === firstDay ? " is-first" : ""}${warned && d === today ? " is-warned" : ""}`} style={{ background: hazards.length ? hazardColor(worst) : "#eef1f4" }} title={`${dayName(d)} ${dayDate(d)}: ${label}${warned && d === today ? " · warning in force" : ""}`} aria-label={`${dayName(d)}: ${label}`} />;
              })}</div>
              <div role="cell" className="week-risk">
                {c.risk && b ? <><strong>{b.text} · {percent(c.risk.probability)}</strong><span className="week-bar"><i style={{ width: `${Math.max(3, Math.min(100, c.risk.probability * 100))}%`, background: RISK_COLOR[b.id] ?? "#888780" }} /></span></> : <span className="sub">No prediction</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
