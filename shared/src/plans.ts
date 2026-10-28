// Synergy's residential electricity plans and their standard prices, from the
// Standard Electricity Prices and Charges brochure (prices as at 1 July 2026, GST included).
// Used to estimate what the customer's last 30 days of usage would cost on each plan,
// so staff can see at a glance whether a different plan would cost less.

export interface PlanPeriod {
  /** Human label including the time band. */
  name: string;
  /** Start hour of the day (0-24). */
  start: number;
  /** End hour of the day (0-24); wraps past midnight, e.g. 21 to 9 for 9pm-9am. */
  end: number;
  /** Cents per kWh (c/kWh). */
  cPerKwh: number;
}

export interface EnergyPlan {
  id: string;
  name: string;
  /** The account's tariff id for this plan (the fixture uses "A1" and "MIDDAY_SAVER"). */
  tariff: string;
  supplyCentsPerDay: number;
  /** One period covering 24h for single-rate plans; several for time-of-use plans. */
  periods: PlanPeriod[];
  /** Eligibility note, e.g. the EV Add On needs a registered plug-in EV. */
  note?: string;
}

export const SYNERGY_PLANS: EnergyPlan[] = [
  {
    id: "a1",
    name: "Home Plan (A1)",
    tariff: "A1",
    supplyCentsPerDay: 119.2419,
    periods: [{ name: "All day", start: 0, end: 24, cPerKwh: 33.2621 }],
  },
  {
    id: "midday_saver",
    name: "Midday Saver",
    tariff: "MIDDAY_SAVER",
    supplyCentsPerDay: 132.7806,
    periods: [
      { name: "Peak 3pm-9pm", start: 15, end: 21, cPerKwh: 55.3253 },
      { name: "Off peak 9pm-9am", start: 21, end: 9, cPerKwh: 24.3431 },
      { name: "Super off peak 9am-3pm", start: 9, end: 15, cPerKwh: 8.8520 },
    ],
  },
  {
    id: "ev_add_on",
    name: "EV Add On",
    tariff: "EV_ADD_ON",
    supplyCentsPerDay: 132.7806,
    periods: [
      { name: "Peak 3pm-9pm", start: 15, end: 21, cPerKwh: 55.3253 },
      { name: "Off peak 9pm-11pm", start: 21, end: 23, cPerKwh: 24.3431 },
      { name: "Off peak 6am-9am", start: 6, end: 9, cPerKwh: 24.3431 },
      { name: "Super off peak 9am-3pm", start: 9, end: 15, cPerKwh: 8.8520 },
      { name: "Overnight 11pm-6am", start: 23, end: 6, cPerKwh: 19.9172 },
    ],
    note: "Only available with a registered plug-in electric vehicle.",
  },
];

// ---------- time-of-day helpers ----------

const normHour = (h: number) => ((h % 24) + 24) % 24;
/** Hours covered by a cyclic interval [start, end); a full day [0, 24) covers 24 hours. */
const spanHours = (start: number, end: number) => {
  const d = normHour(end - start);
  return d === 0 && start !== end ? 24 : d;
};

/** Hours of overlap between two cyclic intervals, [a1, b1) and [a2, b2). */
function overlapHours(a1: number, b1: number, a2: number, b2: number): number {
  const l1 = spanHours(a1, b1);
  const s2 = normHour(a2 - a1);
  const l2 = spanHours(a2, b2);
  const e2 = s2 + l2;
  const part1 = Math.max(0, Math.min(l1, Math.min(e2, 24)) - s2);
  const part2 = e2 > 24 ? Math.min(l1, e2 - 24) : 0;
  return part1 + part2;
}

/** Each plan's periods must cover exactly 24 hours. */
export const planHours = (plan: EnergyPlan) => plan.periods.reduce((s, p) => s + spanHours(p.start, p.end), 0);

// ---------- usage profiles ----------
// The account data is monthly, so the day's kWh cannot be split hour by hour from the data.
// Each customer is instead assigned one of a small set of typical usage patterns, which
// steers how the day's kWh is spread across the plan's peak, off peak and super off peak
// periods. The profile is not shown on the case page; it only guides the estimate.

export interface UsageProfileSegment {
  /** Start hour of the day (0-24). */
  start: number;
  /** End hour of the day (0-24); wraps past midnight. */
  end: number;
  /** Relative use in this band (1 = baseline). */
  weight: number;
}

export interface UsageProfile {
  id: string;
  label: string;
  segments: UsageProfileSegment[];
}

export const USAGE_PROFILES: UsageProfile[] = [
  // Typical 9-5 worker: baseline overnight and during the day, 3x baseline 5:30pm-10pm.
  {
    id: "nine_to_five",
    label: "Typical 9-5 worker",
    segments: [
      { start: 0, end: 17.5, weight: 1 },
      { start: 17.5, end: 22, weight: 3 },
      { start: 22, end: 24, weight: 1 },
    ],
  },
  // Works from or stays at home: baseline overnight, 2x baseline through the day and evening (8am-9pm).
  {
    id: "home",
    label: "Works from or stays at home",
    segments: [
      { start: 0, end: 8, weight: 1 },
      { start: 8, end: 21, weight: 2 },
      { start: 21, end: 24, weight: 1 },
    ],
  },
  // Night owl: baseline from morning to evening, 2x baseline 8pm-3am.
  {
    id: "night_owl",
    label: "Night owl",
    segments: [
      { start: 0, end: 3, weight: 2 },
      { start: 3, end: 20, weight: 1 },
      { start: 20, end: 24, weight: 2 },
    ],
  },
];

/** Even-through-the-day use, used as the fallback and in tests. */
export const UNIFORM_PROFILE: UsageProfile = { id: "uniform", label: "Even through the day", segments: [{ start: 0, end: 24, weight: 1 }] };

/** The customer's profile, stable for the customer id (demo: hash of the id mod the number of profiles). */
export const profileForCustomer = (customerId: string): UsageProfile => {
  let h = 2166136261;
  for (const ch of customerId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return USAGE_PROFILES[h % USAGE_PROFILES.length]!;
};

/** Total relative use (weight × hours) in a profile; also the day's kWh split's denominator. */
export const profileWeight = (profile: UsageProfile) =>
  profile.segments.reduce((s, seg) => s + spanHours(seg.start, seg.end) * seg.weight, 0);

/**
 * Blended usage rate (c/kWh) when the day's kWh is split across the plan's periods in
 * proportion to the profile's weight over each period's hours. With UNIFORM_PROFILE this
 * is the old even-through-the-day blend.
 */
export function blendedRateCentsPerKwh(plan: EnergyPlan, profile: UsageProfile = UNIFORM_PROFILE): number {
  const hours = planHours(plan);
  if (hours !== 24) throw new Error(`${plan.name}'s periods cover ${hours} hours, not 24`);
  const total = profileWeight(profile);
  if (total === 0) throw new Error(`${profile.label}'s segments have no use`);
  return plan.periods.reduce((s, p) => {
    const weight = profile.segments.reduce((w, seg) => w + overlapHours(p.start, p.end, seg.start, seg.end) * seg.weight, 0);
    return s + (weight / total) * p.cPerKwh;
  }, 0);
}

/**
 * Estimated cost (dollars) of `kwh` over `days` on a plan: usage at the profile-blended rate,
 * plus the daily supply charge. Single-rate plans are exact; for time-of-use plans the split
 * between periods follows the customer's usage profile, since the account data is monthly
 * and has no hour-by-hour readings.
 */
export function planCost(plan: EnergyPlan, kwh: number, days: number, profile: UsageProfile = UNIFORM_PROFILE): number {
  return (kwh * blendedRateCentsPerKwh(plan, profile) + days * plan.supplyCentsPerDay) / 100;
}

/** The plan for an account's tariff, if we have one. */
export const planForTariff = (tariff: string): EnergyPlan | null =>
  SYNERGY_PLANS.find((p) => p.tariff === tariff.toUpperCase()) ?? null;
