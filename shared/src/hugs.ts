// The eligibility check for the Hardship Utility Grant Scheme (HUGS), one of the flowchart's solutions.
// The flow flags HUGS as a solution to offer to staff; this module applies the scheme's recorded eligibility
// rules to the account data, so the case page shows which criteria the customer meets before staff refer.
//
// Rules (Synergy's HUGS page, https://www.synergy.net.au/Your-home/Manage-account/Need-help-with-your-bill/HUGS):
// the customer has completed a payment plan for at least 90 days, has been issued a disconnection warning
// or disconnected, owes at least $300 on the bill, and has not received HUGS benefits in the current
// financial year. The scheme also requires Australian citizenship, which the dataset holds no data for, so
// it is not checked here.
import type { CustomerAccount } from "./types";

export interface HugsCriterion {
  id: string;
  label: string;
  met: boolean;
  evidence: string;
}

/** The HUGS eligibility check for one account. */
export interface HugsEligibility {
  recommendationId: string;
  meets: boolean;
  criteria: HugsCriterion[];
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
const dollars = (n: number) => `$${n.toFixed(2)}`;

/** The financial year containing `asOf`: 1 July to 30 June. */
export function financialYear(asOf: string): { start: string; end: string } {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  // A date in July or later belongs to the financial year that starts that year; January to June to the one started a year earlier.
  const startYear = month >= 7 ? year : year - 1;
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` };
}

/**
 * HUGS eligibility for one account as of `asOf`.
 * "Completed a payment plan for at least 90 days" means the plan was kept for at least 90 days: a plan
 * completed or transferred to a hardship program, or one still active, counts for as long as it was kept,
 * and a plan kept for 90 days or more before breaking still counts; a plan broken earlier does not.
 */
export function hugsEligibility(account: CustomerAccount, asOf: string): HugsEligibility {
  const criteria: HugsCriterion[] = [];

  let planDays = 0, planStart: string | null = null;
  for (const p of account.paymentPlans) {
    const days = daysBetween(p.startedAt, p.endedAt && p.endedAt < asOf ? p.endedAt : asOf);
    if (days > planDays) { planDays = days; planStart = p.startedAt; }
  }
  criteria.push({
    id: "payment_plan_90_days",
    label: "Payment plan kept for at least 90 days",
    met: planDays >= 90,
    evidence: planStart ? `Payment plan from ${planStart} kept for ${planDays} days` : "No payment plan on the account",
  });

  const warning = account.collectionEvents.filter((e) => e.action === "disconnection_warning").at(-1);
  const cut = account.disconnections.at(-1);
  const latest = warning && (!cut || warning.date > cut.date)
    ? { date: warning.date, kind: "disconnection warning" }
    : cut ? { date: cut.date, kind: "disconnection" }
    : warning ? { date: warning.date, kind: "disconnection warning" } : null;
  criteria.push({
    id: "disconnection_warning_or_disconnection",
    label: "Disconnection warning or disconnection",
    met: !!latest,
    evidence: latest ? `${latest.kind} on ${latest.date}` : "No disconnection warning or disconnection on record",
  });

  const owing = Math.round(account.bills.reduce((s, b) => s + b.amount - b.amountPaid, 0) * 100) / 100;
  criteria.push({
    id: "owing_at_least_300",
    label: "At least $300 owing on the bill",
    met: owing >= 300,
    evidence: `Owing ${dollars(owing)}`,
  });

  const fy = financialYear(asOf);
  // "Received" means the grant was paid; approved-but-unpaid and declined applications do not count.
  const received = account.hugsGrants
    .filter((g) => g.outcome === "approved" && g.paidAt && g.paidAt >= fy.start && g.paidAt <= fy.end)
    .at(-1);
  criteria.push({
    id: "no_hugs_this_financial_year",
    label: "No HUGS benefit in the current financial year",
    met: !received,
    evidence: received ? `HUGS benefit paid on ${received.paidAt}` : `No HUGS benefit paid since ${fy.start}`,
  });

  return { recommendationId: "hugs", meets: criteria.every((c) => c.met), criteria };
}

/** The eligibility check for the solution a recommendation offers, where one is defined (HUGS only today). */
export function recommendationEligibility(recommendationId: string, account: CustomerAccount, asOf: string): HugsEligibility | null {
  return recommendationId === "hugs" ? hugsEligibility(account, asOf) : null;
}
