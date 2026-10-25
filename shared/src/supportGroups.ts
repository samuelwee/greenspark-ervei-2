/** Action groups organise staff work; they are not diagnoses or benefit-eligibility decisions. */
export const SUPPORT_GROUPS = [
  { id: "health", letter: "A", label: "Health & cooling", reason: "Recorded health or medical cooling needs that staff should check against the forecast.", action: "Arrange a specialist check-in. Confirm cooling, medical equipment and supply needs before the forecast event." },
  { id: "supply", letter: "B", label: "Keep power connected", reason: "Account signals show a supply that has stopped, could run out, or may be disconnected.", action: "Review supply and available assistance urgently. Check reconnection, prepay credit and collection options for each account." },
  { id: "bills", letter: "C", label: "Payment support", reason: "Overdue bills, payment difficulties or recorded affordability needs suggest a support conversation.", action: "Review the current payment arrangement and agree an affordable next step with the customer." },
  { id: "concessions", letter: "D", label: "Concession checks", reason: "A concession has lapsed, or a reported card is not recorded as active on the account. Verify the current details.", action: "Check the concession record, request missing documents and explain the application or renewal process." },
  { id: "coaching", letter: "E", label: "Energy coaching", reason: "A usage spike, seasonal peak, reported bill increase or hard-to-cool home warrants a usage review before considering coaching.", action: "Check the reason for the bill or usage change, then discuss a suitable coaching referral." },
  { id: "monitor", letter: "F", label: "Monitor & follow-up", reason: "No more specific action is supported by the recorded signals. Missing information still needs review.", action: "Confirm the available information and arrange an appropriate follow-up." },
] as const;
export type SupportGroupId = typeof SUPPORT_GROUPS[number]["id"];
export type SupportUrgency = "monitor" | "review" | "urgent";

/** Hue identifies the action; shade identifies attention within that action. */
export const SUPPORT_GROUP_COLORS = {
  health: { strong: "#7024a2", light: "#f4e9fb", ink: "#521576", monitor: "#ceb2e5", review: "#aa6ad0", urgent: "#7024a2" },
  supply: { strong: "#235da8", light: "#eaf1fc", ink: "#184880", monitor: "#a9c9ed", review: "#5598dc", urgent: "#235da8" },
  bills: { strong: "#076e66", light: "#e3f4ef", ink: "#08574f", monitor: "#97d8c9", review: "#39a99a", urgent: "#076e66" },
  concessions: { strong: "#a32686", light: "#fbe9f6", ink: "#7a1c63", monitor: "#e6add7", review: "#cb6cb3", urgent: "#a32686" },
  coaching: { strong: "#08677e", light: "#e1f4f8", ink: "#08586a", monitor: "#9dd5e1", review: "#42a8bf", urgent: "#08677e" },
  monitor: { strong: "#52647c", light: "#edf1f5", ink: "#344256", monitor: "#b9c5d4", review: "#8194ad", urgent: "#52647c" },
} as const;

/** One primary group per customer avoids duplicate work. Other needs stay on their case. */
export interface SupportSignal { id: string; group?: string }
const COACHING_IDS = new Set(["acct_usage_spike", "acct_seasonal_peak", "ask_inefficient_home", "ask_bill_higher"]);
const PAYMENT_IDS = new Set(["acct_missed_payment", "acct_repeated_late", "acct_broken_plan", "acct_many_extensions", "acct_rising_arrears", "acct_dishonour", "acct_partial_payments", "acct_collections", "acct_hardship_exit", "ask_rationing", "ask_trade_offs", "ask_fixed_income", "ask_payment_problem", "ask_other_debts", "ask_lost_job", "ask_less_hours"]);

/** Secondary needs remain available even when an urgent need takes primary placement. */
export function supportGroupNeeds(signals: readonly SupportSignal[]): SupportGroupId[] {
  const needs: SupportGroupId[] = [];
  if (signals.some((s) => s.group === "health")) needs.push("health");
  if (signals.some((s) => s.group === "supply" || ["acct_disconnected", "acct_prepay_low_credit", "acct_disconnection_warning"].includes(s.id))) needs.push("supply");
  if (signals.some((s) => PAYMENT_IDS.has(s.id) || (s.group === "cost" && !COACHING_IDS.has(s.id) && !["acct_concession_on_file", "acct_concession_lapsed"].includes(s.id)))) needs.push("bills");
  if (signals.some((s) => s.id === "acct_concession_lapsed") || (signals.some((s) => s.id === "ask_concession_card") && !signals.some((s) => s.id === "acct_concession_on_file"))) needs.push("concessions");
  if (signals.some((s) => COACHING_IDS.has(s.id))) needs.push("coaching");
  return needs.length ? needs : ["monitor"];
}

export const emptySupportCounts = (): Record<SupportGroupId, number> => ({ health: 0, supply: 0, bills: 0, concessions: 0, coaching: 0, monitor: 0 });

export function primarySupportGroup(signals: readonly SupportSignal[]): SupportGroupId {
  // An interrupted supply takes precedence, including for someone with a recorded health need.
  if (signals.some((s) => s.id === "acct_disconnected" || s.id === "acct_prepay_low_credit")) return "supply";
  const needs = supportGroupNeeds(signals);
  // A specific concession repair takes precedence over general payment support; both needs are retained.
  for (const group of ["health", "supply", "concessions", "bills", "coaching"] as const) if (needs.includes(group)) return group;
  return "monitor";
}

export const SUPPORT_URGENCY = {
  monitor: { label: "Monitor", color: "#d8b4f1", text: "#3b1558", rank: 0 },
  review: { label: "Review soon", color: "#9254c8", text: "#fff", rank: 1 },
  urgent: { label: "Urgent", color: "#581080", text: "#fff", rank: 2 },
} as const;

export function supportUrgency(tier: "act" | "watch" | null): SupportUrgency {
  return tier === "act" ? "urgent" : tier === "watch" ? "review" : "monitor";
}

/** Bubble area is proportional to count, with a readable minimum and a cap to limit obstruction. */
export function supportMarkerRadius(count: number): number {
  return Math.max(9, Math.min(34, 5 * Math.sqrt(Math.max(0, count))));
}
