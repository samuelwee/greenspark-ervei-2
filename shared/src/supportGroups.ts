/** Action groups organise staff work; they are not diagnoses or benefit-eligibility decisions. */
export const SUPPORT_GROUPS = [
  { id: "health", letter: "A", label: "Medical Needs", reason: "Recorded health or medical cooling needs that staff should check against the forecast.", action: "Arrange a specialist check-in. Confirm cooling, medical equipment and supply needs before the forecast event." },
  { id: "disconnected", letter: "B", label: "Disconnected", reason: "The supply has already stopped; the customer is without power.", action: "Fast-track reconnection. Confirm the reconnection path, credit and any emergency assistance before the forecast event." },
  { id: "supply", letter: "C", label: "Low Credit", reason: "Customers with low prepaid credit, or who are already facing disconnection warnings.", action: "Review credit and available assistance urgently. Check top-up options, payment arrangements and the disconnection path for each account." },
  { id: "bills", letter: "D", label: "Financial Hardship", reason: "Overdue bills, payment difficulties or recorded affordability needs suggest a support conversation.", action: "Review the current payment arrangement and agree an affordable next step with the customer." },
  { id: "coaching", letter: "E", label: "Unusual Trend", reason: "A usage spike, seasonal peak, reported bill increase, hard-to-cool home or a lapsed concession that will raise the bill warrants a review of the driver.", action: "Check the reason for the bill or usage change, then discuss a suitable coaching referral or concession renewal." },
] as const;
export type SupportGroupId = typeof SUPPORT_GROUPS[number]["id"];
export type SupportUrgency = "monitor" | "review" | "urgent";

/** Hue identifies the action; shade identifies attention within that action. */
export const SUPPORT_GROUP_COLORS = {
  health: { strong: "#7024a2", light: "#f4e9fb", ink: "#521576", monitor: "#ceb2e5", review: "#aa6ad0", urgent: "#7024a2" },
  disconnected: { strong: "#b3161c", light: "#fbeaec", ink: "#8a1015", monitor: "#e8b3b0", review: "#d06a66", urgent: "#b3161c" },
  supply: { strong: "#235da8", light: "#eaf1fc", ink: "#184880", monitor: "#a9c9ed", review: "#5598dc", urgent: "#235da8" },
  bills: { strong: "#076e66", light: "#e3f4ef", ink: "#08574f", monitor: "#97d8c9", review: "#39a99a", urgent: "#076e66" },
  coaching: { strong: "#08677e", light: "#e1f4f8", ink: "#08586a", monitor: "#9dd5e1", review: "#428cbf", urgent: "#08677e" },
} as const;

/** One primary group per customer avoids duplicate work. Other needs stay on their case. */
export interface SupportSignal { id: string; group?: string }
const COACHING_IDS = new Set(["acct_usage_spike", "acct_seasonal_peak", "ask_inefficient_home", "ask_bill_higher"]);
const CONCESSED_IDS = new Set(["acct_concession_on_file", "acct_concession_lapsed"]);
const PAYMENT_IDS = new Set(["acct_missed_payment", "acct_repeated_late", "acct_broken_plan", "acct_many_extensions", "acct_rising_arrears", "acct_dishonour", "acct_partial_payments", "acct_collections", "acct_hardship_exit", "ask_rationing", "ask_trade_offs", "ask_fixed_income", "ask_payment_problem", "ask_other_debts", "ask_lost_job", "ask_less_hours"]);

/** Secondary needs remain available even when an urgent need takes primary placement. */
export function supportGroupNeeds(signals: readonly SupportSignal[]): SupportGroupId[] {
  const needs: SupportGroupId[] = [];
  if (signals.some((s) => s.group === "health")) needs.push("health");
  if (signals.some((s) => s.id === "acct_disconnected")) needs.push("disconnected");
  if (signals.some((s) => (s.group === "supply" && s.id !== "acct_disconnected") || s.id === "acct_prepay_low_credit" || s.id === "acct_disconnection_warning")) needs.push("supply");
  if (signals.some((s) => PAYMENT_IDS.has(s.id) || (s.group === "cost" && !COACHING_IDS.has(s.id) && !CONCESSED_IDS.has(s.id)))) needs.push("bills");
  if (signals.some((s) => COACHING_IDS.has(s.id) || s.id === "acct_concession_lapsed" || (s.id === "ask_concession_card" && !signals.some((x) => x.id === "acct_concession_on_file")))) needs.push("coaching");
  return needs;
}

export const emptySupportCounts = (): Record<SupportGroupId, number> => ({ health: 0, disconnected: 0, supply: 0, bills: 0, coaching: 0 });

/** No group when no recorded signal supports a specific action; their needs are reviewed in the case queue. */
export function primarySupportGroup(signals: readonly SupportSignal[]): SupportGroupId | null {
  // An interrupted supply takes precedence, including for someone with a recorded health need.
  if (signals.some((s) => s.id === "acct_disconnected")) return "disconnected";
  // Low prepaid credit also takes precedence over other recorded needs.
  if (signals.some((s) => s.id === "acct_prepay_low_credit")) return "supply";
  const needs = supportGroupNeeds(signals);
  // The most specific action wins; all needs are retained on the case.
  for (const group of ["health", "supply", "bills", "coaching"] as const) if (needs.includes(group)) return group;
  return null;
}

/** True when the customer's primary group is one of the selected groups (null is never selected). */
export const groupIn = (groups: readonly SupportGroupId[], group: SupportGroupId | null): boolean => group !== null && groups.includes(group);

export const SUPPORT_URGENCY = {
  monitor: { label: "Monitor", color: "#d8b4f1", text: "#3b1558", rank: 0 },
  review: { label: "Review soon", color: "#9254c8", text: "#fff", rank: 1 },
  urgent: { label: "Urgent", color: "#581080", text: "#fff", rank: 2 },
};

export function supportUrgency(tier: "act" | "watch" | null): SupportUrgency {
  return tier === "act" ? "urgent" : tier === "watch" ? "review" : "monitor";
}

/** Bubble area is proportional to count, with a readable minimum and a cap to limit obstruction. */
export function supportMarkerRadius(count: number): number {
  return Math.max(9, Math.min(34, 5 * Math.sqrt(Math.max(0, count))));
}
