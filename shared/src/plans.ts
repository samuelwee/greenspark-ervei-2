// Synergy's residential electricity plans and their standard prices, from the
// Standard Electricity Prices and Charges brochure (prices as at 1 July 2026, GST included).
// Used to estimate what the customer's last 30 days of usage would cost on each plan,
// so staff can see at a glance whether a different plan would cost less.

export interface PlanPeriod {
  /** Human label including the time band. */
  name: string;
  /** Hours of the day this period covers (all periods cover 24 hours together). */
  hours: number;
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
    periods: [{ name: "All day", hours: 24, cPerKwh: 33.2621 }],
  },
  {
    id: "midday_saver",
    name: "Midday Saver",
    tariff: "MIDDAY_SAVER",
    supplyCentsPerDay: 132.7806,
    periods: [
      { name: "Peak 3pm–9pm", hours: 6, cPerKwh: 55.3253 },
      { name: "Off peak 9pm–9am", hours: 12, cPerKwh: 24.3431 },
      { name: "Super off peak 9am–3pm", hours: 6, cPerKwh: 8.8520 },
    ],
  },
  {
    id: "ev_add_on",
    name: "EV Add On",
    tariff: "EV_ADD_ON",
    supplyCentsPerDay: 132.7806,
    periods: [
      { name: "Peak 3pm–9pm", hours: 6, cPerKwh: 55.3253 },
      { name: "Off peak 9pm–11pm, 6am–9am", hours: 5, cPerKwh: 24.3431 },
      { name: "Super off peak 9am–3pm", hours: 6, cPerKwh: 8.8520 },
      { name: "Overnight 11pm–6am", hours: 7, cPerKwh: 19.9172 },
    ],
    note: "Only available with a registered plug-in electric vehicle.",
  },
];

/** Each plan's periods must cover exactly 24 hours. */
export const planHours = (plan: EnergyPlan) => plan.periods.reduce((s, p) => s + p.hours, 0);

/**
 * Blended usage rate (c/kWh) when the day's kWh is split across the plan's periods
 * in proportion to each period's hours, i.e. usage spread evenly through the day.
 */
export function blendedRateCentsPerKwh(plan: EnergyPlan): number {
  const hours = planHours(plan);
  if (hours !== 24) throw new Error(`${plan.name}'s periods cover ${hours} hours, not 24`);
  return plan.periods.reduce((s, p) => s + (p.hours / hours) * p.cPerKwh, 0);
}

/**
 * Estimated cost (dollars) of `kwh` over `days` on a plan: usage at the blended rate,
 * plus the daily supply charge. Single-rate plans are exact; for time-of-use plans the
 * split between periods is an assumption — the account data is monthly, so the hour-by-hour
 * profile is not recorded and is assumed to spread evenly through the day.
 */
export function planCost(plan: EnergyPlan, kwh: number, days: number): number {
  return (kwh * blendedRateCentsPerKwh(plan) + days * plan.supplyCentsPerDay) / 100;
}

/** The plan for an account's tariff, if we have one. */
export const planForTariff = (tariff: string): EnergyPlan | null =>
  SYNERGY_PLANS.find((p) => p.tariff === tariff.toUpperCase()) ?? null;
