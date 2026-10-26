// Applies the hardship flowchart (signals -> circumstances -> solutions) to the case queue.
// Signals come from each person's account (accountSignals.ts), from survey answers that say the same thing
// as one of the flow's self-report signals, and from Bureau of Meteorology forecasts for their postcode (weather.ts). Circumstances are flagged with the flow's own scoring rules:
//   at least 1 strong signal, or at least 2 supporting signals;
//   sensitive and safety circumstances need at least 1 strong signal;
//   safety circumstances are never actioned automatically (the case page routes them to trained staff).
// Solutions are the flagged circumstances' solutions. Everything is worked out again whenever the flow changes.
import { ACCOUNT_SIGNAL_IDS, detectAccountSignals } from "./accountSignals";
import { priorityFromSignals } from "./priority";
import { WEATHER_SIGNAL_IDS, type WeatherSignal } from "./weather";
import { AREA_SIGNAL_ID, areaSignal } from "./area";
import type { FlowDoc } from "./flow";
import type {
  AccountSignalSummary, CaseCircumstance, CaseRecommendation, CaseSignal, CircumstanceDefinition, Person, QueueCase, QueueDataset,
  RecommendationDefinition, SupportArea,
} from "./types";

/** The utility the demo's accounts and survey are about. Flow entries for other utilities don't apply. */
export const CASE_UTILITY = "electricity";

/**
 * Survey answers that are the customer telling us the same thing as a self-report signal in the flow.
 * Survey questions with no matching self-report signal (difficulty paying, paying on time, overall financial
 * situation, keeping warm or cool) are left out; the account signals cover the payment side.
 */
export const SURVEY_SIGNALS: { signalId: string; fieldId: string; answers: string[] }[] = [
  { signalId: "ask_trade_offs", fieldId: "Q35_8", answers: ["Yes"] }, // couldn't afford other essentials
  { signalId: "ask_rationing", fieldId: "Q35_3", answers: ["Yes"] }, // avoided heating or cooling to save money
  { signalId: "ask_medical_equipment", fieldId: "Z7_4", answers: ["Yes"] }, // life-support registration
  { signalId: "ask_temperature_need", fieldId: "Z7_6", answers: ["Yes"] }, // health or disability affects energy use
  { signalId: "ask_concession_card", fieldId: "Z7_8", answers: ["Yes"] }, // has an energy-bill concession
];

/**
 * Things customers say in contact transcripts that are the same as a self-report signal in the flow. Only the
 * customer's own words count, from the last 12 months. Vaguer remarks ("things are a bit tight") are left out.
 */
export const TRANSCRIPT_SIGNALS: { signalId: string; pattern: RegExp }[] = [
  { signalId: "ask_lost_job", pattern: /lost my job/i },
  { signalId: "ask_less_hours", pattern: /hours got cut back/i },
  { signalId: "ask_housing_costs", pattern: /rent went up/i },
  { signalId: "ask_unexpected_cost", pattern: /big car repair/i },
  { signalId: "ask_rationing", pattern: /sitting in the dark|not to run the air con/i },
  { signalId: "ask_other_debts", pattern: /behind on a few bills/i },
  { signalId: "ask_illness", pattern: /off work sick/i },
  { signalId: "ask_payment_problem", pattern: /payments haven't come through/i },
  { signalId: "ask_single_parent", pattern: /on my own with the kids/i },
  { signalId: "ask_bill_higher", pattern: /bill is way higher|bill was a lot higher|nearly double/i },
  { signalId: "ask_bill_wrong", pattern: /doesn't look right|meter reading is wrong|meter being read properly/i },
  { signalId: "ask_concession_card", pattern: /got a concession card/i },
  { signalId: "ask_bad_experience", pattern: /formal complaint|third time I've called|nobody has fixed this/i },
  { signalId: "ask_moving", pattern: /moving house|move the account to a new address/i },
];

/** Facts recorded on the account that mean the same as a self-report signal. */
const ACCOUNT_FACT_SIGNALS: { signalId: string; holds: (p: Person) => string | null }[] = [
  { signalId: "ask_temperature_need", holds: (p) => (p.account?.medicalCoolingSubsidy ? "Account: receives the medical cooling subsidy (TDES)" : null) },
];

/** In words, for the Flowchart page: the account facts above that mean the same as a self-report signal. */
export const ACCOUNT_FACT_SIGNAL_TEXT: Record<string, string> = { ask_temperature_need: "The account records the medical cooling subsidy (TDES)" };

const applies = (utilities: string[]) => utilities.includes(CASE_UTILITY);

/**
 * Whether the app has data that can raise this signal: an account signal needs a detection rule over the
 * account data; a self-report signal needs a survey question, a transcript phrase or an account fact that says
 * the same thing. Others never fire.
 */
export function signalHasData(signal: { id: string; source: string }): boolean {
  if (signal.source === "account") return ACCOUNT_SIGNAL_IDS.includes(signal.id);
  if (signal.source === "weather") return WEATHER_SIGNAL_IDS.includes(signal.id);
  if (signal.source === "area") return signal.id === AREA_SIGNAL_ID;
  return [...SURVEY_SIGNALS, ...TRANSCRIPT_SIGNALS, ...ACCOUNT_FACT_SIGNALS].some((m) => m.signalId === signal.id);
}

/** Support areas, circumstances and recommendations for the queue, built from the flow. */
export function flowCatalog(doc: FlowDoc): Pick<QueueDataset, "supportAreas" | "circumstances" | "recommendations"> {
  const circumstances: CircumstanceDefinition[] = doc.circumstances.filter((c) => applies(c.utilities)).map((c) => ({
    id: c.id, label: c.name, supportAreaId: c.category, evidenceFieldIds: [],
    recommendationIds: c.solutions.filter((id) => doc.solutions.some((s) => s.id === id && applies(s.utilities))),
    illustrativeRule: c.description, sensitivity: c.sensitivity, type: c.type, handling: c.handling,
  }));
  const supportAreas: SupportArea[] = doc.categories
    .map((cat) => ({ id: cat.id, label: cat.name, circumstanceIds: circumstances.filter((c) => c.supportAreaId === cat.id).map((c) => c.id) }))
    .filter((a) => a.circumstanceIds.length > 0);
  const recommendations: RecommendationDefinition[] = doc.solutions.filter((s) => applies(s.utilities)).map((s) => ({
    id: s.id, label: s.name, description: s.key_facts, provider: s.provider, howToAccess: s.how_to_access,
    contact: s.contact, sourceUrl: s.source_url, verified: s.verified, lastVerified: s.last_verified,
  }));
  return { supportAreas, circumstances, recommendations };
}

/** Every flow signal seen for one case, without strengths (strength belongs to each signal-circumstance link). */
/**
 * What a person's account says, for caseSignals: account-rule signals, then account facts and transcript phrases.
 * Worked out once when an account is stored, so the queue can find every case's signals without the accounts.
 */
export function accountSignalSummary(person: Person, asOf: string): AccountSignalSummary | null {
  const account = person.account;
  if (!account) return null;
  const selfReport: AccountSignalSummary["selfReport"] = [];
  for (const m of ACCOUNT_FACT_SIGNALS) { const evidence = m.holds(person); if (evidence) selfReport.push({ id: m.signalId, evidence }); }
  // Newest contacts first, so the evidence quotes the latest time the customer said it.
  const year = account.contacts.filter((x) => x.transcript && x.date <= asOf && Date.parse(asOf) - Date.parse(x.date) <= 365 * 86_400_000);
  for (const contact of [...year].reverse()) {
    for (const turn of contact.transcript!) {
      if (turn.speaker !== "customer") continue;
      for (const m of TRANSCRIPT_SIGNALS) {
        if (m.pattern.test(turn.text)) selfReport.push({ id: m.signalId, evidence: `Said on ${contact.channel.replace(/_/g, " ")}, ${contact.date}: "${turn.text}"` });
      }
    }
  }
  return {
    account: detectAccountSignals(account, asOf).map((s) => ({ id: s.id, evidence: s.evidence })),
    selfReport, northOf26th: account.region.northOf26th,
  };
}

export function caseSignals(
  c: QueueCase, person: Person | null, data: Pick<QueueDataset, "asOf" | "evidenceFields">, doc: FlowDoc, weather: WeatherSignal[] = [],
): Omit<CaseSignal, "strength">[] {
  const names = new Map(doc.signals.map((s) => [s.id, s.name]));
  const out: Omit<CaseSignal, "strength">[] = [];
  // The full account when there is one (the case page), otherwise the summary stored with the person (the queue).
  const summary = person?.account ? accountSignalSummary(person, data.asOf) : person?.signalSummary ?? null;
  for (const s of summary?.account ?? []) {
    if (names.has(s.id)) out.push({ id: s.id, name: names.get(s.id)!, source: "account", evidence: s.evidence });
  }
  for (const m of SURVEY_SIGNALS) {
    const answer = c.reportedAnswers[m.fieldId];
    if (!answer || !m.answers.includes(answer) || !names.has(m.signalId)) continue;
    const label = data.evidenceFields.find((f) => f.id === m.fieldId)?.label ?? m.fieldId;
    out.push({
      id: m.signalId, name: names.get(m.signalId)!, source: "self_report", evidenceFieldId: m.fieldId,
      evidence: `Survey: ${label}: ${answer}${c.reportedAt ? ` (reported ${c.reportedAt})` : ""}`,
    });
  }
  for (const s of summary?.selfReport ?? []) {
    if (names.has(s.id)) out.push({ id: s.id, name: names.get(s.id)!, source: "self_report", evidence: s.evidence });
  }
  for (const s of weather) if (names.has(s.id)) out.push({ id: s.id, name: names.get(s.id)!, source: "weather", evidence: s.evidence });
  // Where the customer lives (ABS SEIFA): worked out from the postcode each time, so it needs no stored summary.
  const area = areaSignal(person?.address?.postcode);
  if (area && names.has(area.id)) out.push({ id: area.id, name: names.get(area.id)!, source: "area", evidence: area.evidence });
  // One entry per signal: account data first, then the survey, then account facts, transcripts and weather.
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** The flagged circumstances, support areas and solutions for one case. */
export function evaluateCase(
  c: QueueCase, person: Person | null, data: Pick<QueueDataset, "asOf" | "evidenceFields">, doc: FlowDoc, catalog = flowCatalog(doc), weather: WeatherSignal[] = [],
) {
  const seen = new Map(caseSignals(c, person, data, doc, weather).map((s) => [s.id, s]));
  const circumstances: CaseCircumstance[] = [];
  for (const def of doc.circumstances) {
    if (!applies(def.utilities)) continue;
    const signals: CaseSignal[] = def.signals.flatMap((l) => (seen.has(l.id) ? [{ ...seen.get(l.id)!, strength: l.strength }] : []));
    // Area signals describe where someone lives, not the person: they never count towards flagging, but once a
    // circumstance is flagged by the customer's own evidence they stay in its signals and add their points.
    const own = signals.filter((s) => s.source !== "area");
    const strong = own.filter((s) => s.strength === "strong").length;
    const flagged = def.sensitivity === "standard" ? strong >= 1 || own.length - strong >= 2 : strong >= 1;
    if (!flagged) continue;
    circumstances.push({
      circumstanceId: def.id,
      evidenceFieldIds: [...new Set(signals.flatMap((s) => (s.evidenceFieldId ? [s.evidenceFieldId] : [])))],
      signals,
    });
  }
  const defs = new Map(catalog.circumstances.map((d) => [d.id, d]));
  const supportAreaIds = catalog.supportAreas.filter((a) => circumstances.some((x) => defs.get(x.circumstanceId)?.supportAreaId === a.id)).map((a) => a.id);
  const reviewStatus = c.workflow.reviewStatus === "reviewed" ? "reviewed" : "pending";
  const recommendations: CaseRecommendation[] = [];
  for (const r of catalog.recommendations) {
    const uses = circumstances.filter((x) => defs.get(x.circumstanceId)?.recommendationIds.includes(r.id));
    if (!uses.length) continue;
    recommendations.push({
      recommendationId: r.id, circumstanceIds: uses.map((x) => x.circumstanceId),
      evidenceFieldIds: [...new Set(uses.flatMap((x) => x.evidenceFieldIds))], reviewStatus,
    });
  }
  const hasData = !!person?.account || !!person?.signalSummary || Object.values(c.reportedAnswers).some((v) => v !== null);
  const modelAssessment = priorityFromSignals(circumstances, defs, hasData);
  return { circumstances, supportAreaIds, recommendations, modelAssessment };
}

/** The dataset with the flow's catalogs, and every case's circumstances and solutions worked out from the flow. */
export function applyFlow(data: QueueDataset, doc: FlowDoc): QueueDataset {
  const catalog = flowCatalog(doc);
  const people = new Map(data.people.map((p) => [p.id, p]));
  return {
    ...data, ...catalog, circumstanceSource: "flow",
    cases: data.cases.map((c) => ({ ...c, ...evaluateCase(c, people.get(c.personId) ?? null, data, doc, catalog) })),
  };
}
