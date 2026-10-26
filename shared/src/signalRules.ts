// The rule each flowchart signal is actually detected by, in plain words, for the Flowchart page. The signals'
// own "example rule" in the flowchart file is only illustrative; these describe what the code does.
// Account rules follow accountSignals.ts, survey and transcript matches follow caseFlow.ts, weather follows
// weather.ts and the area rule follows area.ts. If a rule changes there, change its words here.
import { ACCOUNT_SIGNAL_IDS } from "./accountSignals";
import { ACCOUNT_FACT_SIGNAL_TEXT, SURVEY_SIGNALS, TRANSCRIPT_SIGNALS } from "./caseFlow";
import { AREA_DECILE_LIMIT, AREA_SIGNAL_ID } from "./area";
import { HEAT_THRESHOLD } from "./weather";

const ACCOUNT_RULES: Record<string, string> = {
  acct_missed_payment: "A bill is past its due date and not fully paid.",
  acct_repeated_late: "Late on 3 or more of the last 6 bills (paid after the due date, or still owing past it).",
  acct_broken_plan: "A payment plan is marked broken, and it started or ended in the last 12 months.",
  acct_many_extensions: "2 or more bill extensions requested in the last 12 months.",
  acct_rising_arrears: "The overdue amount is higher at each of three month-end readings, two months apart, and is still owing.",
  acct_dishonour: "At least 1 dishonoured (failed) payment in the last 90 days.",
  acct_partial_payments: "3 or more cleared payments, each under half of one bill issued in the last 12 months. Grants and write-offs don't count.",
  acct_payday_aligned: "4 or more payments or prepay top-ups in a row, each 13 to 15 days after the last, within the last 180 days.",
  acct_usage_spike: "Usage on the latest bill (or the last two complete months for prepay) is more than 1.4 times the same period a year earlier.",
  acct_usage_drop: "Supply is connected and usage is under half the same period a year earlier.",
  acct_prepay_low_credit: "A prepay meter ran out of credit 2 or more times in the last 30 days.",
  acct_seasonal_peak: "With at least 4 bills in the last 12 months, the biggest bill before credits is more than 1.6 times the 12-month average.",
  acct_concession_lapsed: "Concession status is lapsed, and it ended in the last 90 days.",
  acct_concession_on_file: "Concession status is active on the account.",
  acct_repeat_contact: "3 or more inbound contacts about the same reason in the last 60 days.",
  acct_complaint: "A complaint or ombudsman referral in the last 90 days that isn't resolved.",
  acct_returned_mail: "A message was not delivered (returned mail or a bounced email) in the last 90 days.",
  acct_digital_disengaged: "No active online account, and no messages opened in the last 90 days.",
  acct_interpreter: "The account is marked as needing an interpreter.",
  acct_life_support: "Life support is registered on the account.",
  acct_disconnection_warning: "A disconnection warning was sent in the last 30 days.",
  acct_disconnected: "Supply status is disconnected.",
  acct_collections: "Referred to a debt collection agency in the last 12 months, and money is still overdue.",
  acct_hardship_exit: "Left the hardship program in the last 12 months for a reason other than completing it, and isn't in it now.",
  acct_third_party_authority: "A third-party authority (such as a nominee) is recorded on the account.",
  acct_cash_only: "3 or more cleared payments, all made in person at a cash counter.",
  acct_no_hardship_offer: "A bill has been overdue for more than 60 days, with no hardship assessment or offer in the last 12 months.",
  acct_outage_history: "3 or more outages in the last 12 months, or any single outage longer than 12 hours.",
  acct_remote_area: "The supply region is north of the 26th parallel.",
  acct_unanswered_outreach: "3 or more outbound calls not answered in the last 6 months.",
  acct_solar_export_zero: "Solar export last complete month was under 20% of the same month a year earlier (which was over 5 kWh).",
  acct_move: "The account was opened in the last 60 days.",
  acct_bill_up_flat_usage: "The latest bill is more than 1.2 times the same period a year earlier, while usage changed by 5% or less.",
};

const SURVEY_TEXT: Record<string, string> = {
  ask_trade_offs: "couldn't afford other essentials",
  ask_rationing: "avoided heating or cooling to save money",
  ask_medical_equipment: "life-support registration",
  ask_temperature_need: "health or disability affects energy use",
  ask_concession_card: "has an energy-bill concession",
};

const WEATHER_RULES: Record<string, string> = {
  wx_extreme_heat: `A forecast maximum of ${HEAT_THRESHOLD.south}°C or more (${HEAT_THRESHOLD.north}°C or more north of the 26th parallel) in the customer's forecast town, on any day from today.`,
  wx_fire_danger: "An Extreme or Catastrophic fire danger rating for the customer's district on any day from today.",
  wx_warning: "A Bureau weather warning for the customer's district whose title mentions heat, severe weather, thunderstorm, fire weather, bushfire, cyclone, flood or damaging wind. Marine and sheep graziers warnings are left out.",
};

/** The phrases a transcript pattern looks for, e.g. "lost my job" or "sitting in the dark" and "not to run the air con". */
const phrases = (pattern: RegExp) => pattern.source.split("|").map((p) => `"${p.replace(/\\/g, "")}"`);

/** The rule a signal is detected by, in plain words, or null when the app has no data for it. */
export function actualRule(signal: { id: string; source: string }): string | null {
  if (signal.source === "account") return ACCOUNT_SIGNAL_IDS.includes(signal.id) ? ACCOUNT_RULES[signal.id] ?? null : null;
  if (signal.source === "weather") return WEATHER_RULES[signal.id] ?? null;
  if (signal.source === "area") return signal.id === AREA_SIGNAL_ID ? `The postcode is in the most disadvantaged ${AREA_DECILE_LIMIT * 10}% of WA postcodes (SEIFA 2021 disadvantage index, WA decile ${AREA_DECILE_LIMIT} or lower). It describes the area, never the person.` : null;
  const parts: string[] = [];
  for (const m of SURVEY_SIGNALS.filter((x) => x.signalId === signal.id)) parts.push(`The survey answer to ${m.fieldId} is ${m.answers.map((a) => `"${a}"`).join(" or ")}${SURVEY_TEXT[signal.id] ? ` (${SURVEY_TEXT[signal.id]})` : ""}.`);
  const said = TRANSCRIPT_SIGNALS.filter((x) => x.signalId === signal.id).flatMap((x) => phrases(x.pattern));
  if (said.length) parts.push(`The customer says ${said.join(" or ")} in a contact in the last 12 months.`);
  if (ACCOUNT_FACT_SIGNAL_TEXT[signal.id]) parts.push(`${ACCOUNT_FACT_SIGNAL_TEXT[signal.id]}.`);
  return parts.length ? parts.join(" ") : null;
}
