// The weather outlook: which customers the next week's forecast puts at risk. Exposure is what the Bureau forecasts
// for the customer's area (heat, fire danger, warnings); sensitivity is what we know about them that makes that
// weather harder to cope with (health, a supply that can run out, the cost of cooling, isolation).
import type { Person } from "./types";
import { FIRE_RATINGS, HEAT_THRESHOLD, POSTCODE_TOWN, isRelevantWarning, type WeatherSnapshot } from "./weather";

export type HazardKind = "heat" | "hot" | "fire" | "warning";
export interface Hazard { kind: HazardKind; date: string; severity: number; text: string }
export type SensitivityGroup = "health" | "supply" | "cost" | "isolation";
export interface SensitivityFactor { id: string; group: SensitivityGroup; label: string; weight: number }
export type OutlookTier = "act" | "watch";

/** A hot day short of extreme heat still matters for people whose health or supply is at risk. */
export const HOT_MARGIN = 4;

/** Account and self-report signals that make hot or dangerous weather harder to cope with. */
export const SENSITIVITY: Record<string, Omit<SensitivityFactor, "id">> = {
  acct_life_support: { group: "health", label: "Life support", weight: 5 },
  ask_temperature_need: { group: "health", label: "Medical need for cooling", weight: 5 },
  ask_medical_equipment: { group: "health", label: "Medical equipment", weight: 4 },
  ask_illness: { group: "health", label: "Serious illness", weight: 3 },
  ask_older: { group: "health", label: "Older person", weight: 3 },
  ask_disability: { group: "health", label: "Disability", weight: 3 },
  acct_access_needs: { group: "health", label: "Access needs", weight: 2 },
  acct_disconnected: { group: "supply", label: "Disconnected", weight: 4 },
  acct_prepay_low_credit: { group: "supply", label: "Prepay credit low", weight: 4 },
  acct_disconnection_warning: { group: "supply", label: "Disconnection warning", weight: 3 },
  acct_small_recharges: { group: "supply", label: "Small recharges", weight: 2 },
  ask_prepay: { group: "supply", label: "Prepay meter", weight: 2 },
  ask_rationing: { group: "cost", label: "Going without", weight: 3 },
  ask_trade_offs: { group: "cost", label: "Bills vs food or medicine", weight: 3 },
  acct_seasonal_peak: { group: "cost", label: "Big summer bills", weight: 2 },
  ask_inefficient_home: { group: "cost", label: "Hard-to-cool home", weight: 2 },
  acct_rising_arrears: { group: "cost", label: "Arrears growing", weight: 2 },
  acct_missed_payment: { group: "cost", label: "Bill overdue", weight: 1 },
  ask_fixed_income: { group: "cost", label: "Fixed income", weight: 1 },
  acct_concession_on_file: { group: "cost", label: "Concession card", weight: 1 },
  acct_remote_area: { group: "isolation", label: "Remote supply area", weight: 2 },
  ask_remote_community: { group: "isolation", label: "Remote community", weight: 2 },
  acct_outage_history: { group: "isolation", label: "Outage history", weight: 2 },
  acct_digital_disengaged: { group: "isolation", label: "Hard to reach online", weight: 1 },
  acct_interpreter: { group: "isolation", label: "Interpreter", weight: 1 },
  ask_no_internet: { group: "isolation", label: "No internet or phone credit", weight: 1 },
};
export const SENSITIVITY_GROUPS: Record<SensitivityGroup, string> = { health: "Health", supply: "Supply could stop", cost: "Can't afford cooling", isolation: "Isolated" };
/** Needs that make a hot day (not only extreme heat) a reason to call. */
const CRITICAL = new Set(["acct_life_support", "ask_temperature_need", "ask_medical_equipment", "acct_disconnected", "acct_prepay_low_credit"]);

/** What we know about a person that raises their sensitivity, strongest first. */
export function sensitivityOf(person: Person): SensitivityFactor[] {
  const s = person.signalSummary;
  if (!s) return [];
  const ids = new Set([...s.account, ...s.selfReport].map((x) => x.id));
  return [...ids].flatMap((id) => (SENSITIVITY[id] ? [{ id, ...SENSITIVITY[id]! }] : [])).sort((a, b) => b.weight - a.weight);
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");

/** Each day's hazards in a forecast town, looking ahead from `today`. North of the 26th parallel uses higher heat limits. */
export function townHazards(w: WeatherSnapshot, townId: string, north: boolean, today: string, through?: string): Hazard[] {
  const town = w.towns[townId];
  if (!town) return [];
  const limit = north ? HEAT_THRESHOLD.north : HEAT_THRESHOLD.south;
  const out: Hazard[] = [];
  for (const d of town.days) {
    if (d.date < today || (through && d.date > through) || d.max === null) continue;
    if (d.max >= limit) out.push({ kind: "heat", date: d.date, severity: d.max >= limit + 3 ? 4 : 3, text: `${d.max}°C ${weekday(d.date)}` });
    else if (d.max >= limit - HOT_MARGIN) out.push({ kind: "hot", date: d.date, severity: 1, text: `${d.max}°C ${weekday(d.date)}` });
  }
  for (const f of w.fireDanger[town.district] ?? []) {
    const rank = FIRE_RATINGS.indexOf(f.rating);
    if (f.date >= today && (!through || f.date <= through) && rank >= FIRE_RATINGS.indexOf("Extreme")) out.push({ kind: "fire", date: f.date, severity: rank === FIRE_RATINGS.length - 1 ? 4 : 3, text: `${f.rating} fire danger ${weekday(f.date)}` });
  }
  for (const x of w.warnings) if (x.districts.includes(town.district) && isRelevantWarning(x.title) && (!x.expires || Date.parse(x.expires) > Date.parse(`${today}T00:00:00+08:00`))) out.push({ kind: "warning", date: today, severity: 3, text: x.title });
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.severity - a.severity);
}

export interface OutlookCustomer {
  personId: string; townId: string; hazards: Hazard[]; sensitivity: SensitivityFactor[];
  /** The worst hazard's severity: 1 for a hot day, 3 or 4 for extreme heat, fire danger or a warning. */
  exposure: number; tier: OutlookTier | null; score: number;
}

/**
 * One customer's outlook. Act: dangerous weather and a health or supply need, or any hot day with a critical one
 * (life support, medical cooling, a supply that has stopped or is about to). Watch: any hot weather and a need that
 * adds up (a concession card alone doesn't), or dangerous weather and a high predicted risk.
 */
export function customerOutlook(person: Person, w: WeatherSnapshot, today: string, highRisk: boolean, risk = 0, through?: string): OutlookCustomer | null {
  const postcode = person.address?.postcode;
  const townId = postcode ? POSTCODE_TOWN[postcode] : undefined;
  if (!townId || !w.towns[townId]) return null;
  const north = person.account?.region.northOf26th ?? person.signalSummary?.northOf26th ?? false;
  const hazards = townHazards(w, townId, north, today, through);
  const sensitivity = sensitivityOf(person);
  const exposure = Math.max(0, ...hazards.map((h) => h.severity));
  const groups = new Set(sensitivity.map((s) => s.group));
  const critical = sensitivity.some((s) => CRITICAL.has(s.id));
  const points = sensitivity.reduce((n, s) => n + s.weight, 0);
  let tier: OutlookTier | null = null;
  if ((exposure >= 3 && (groups.has("health") || groups.has("supply"))) || (exposure >= 1 && critical)) tier = "act";
  else if ((exposure >= 1 && (points >= 3 || groups.has("health") || groups.has("supply"))) || (exposure >= 3 && highRisk)) tier = "watch";
  const score = Math.round((exposure * (1 + Math.min(points, 15)) + 20 * risk) * 10) / 10;
  return { personId: person.id, townId, hazards, sensitivity, exposure, tier, score };
}
