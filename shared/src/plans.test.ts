import { describe, expect, it } from "vitest";
import { blendedRateCentsPerKwh, planCost, planForTariff, planHours, SYNERGY_PLANS } from "./plans";

describe("Synergy plan prices", () => {
  it("every plan's periods cover exactly 24 hours", () => {
    for (const p of SYNERGY_PLANS) expect(planHours(p)).toBe(24);
  });

  it("matches the account tariffs in the fixture", () => {
    expect(planForTariff("A1")?.name).toBe("Home Plan (A1)");
    expect(planForTariff("midday_saver")?.name).toBe("Midday Saver");
    expect(planForTariff("unknown_tariff")).toBeNull();
  });

  it("single-rate plans use the flat rate", () => {
    expect(blendedRateCentsPerKwh(SYNERGY_PLANS[0]!)).toBeCloseTo(33.2621, 4);
  });

  it("time-of-use plans blend the period rates in proportion to their hours", () => {
    // Midday Saver: (6×55.3253 + 12×24.3431 + 6×8.8520) / 24 = 28.215875 c/kWh
    expect(blendedRateCentsPerKwh(SYNERGY_PLANS[1]!)).toBeCloseTo(28.215875, 4);
    // EV Add On: (6×55.3253 + 5×24.3431 + 6×8.8520 + 7×19.9172) / 24 = 26.9249875 c/kWh
    expect(blendedRateCentsPerKwh(SYNERGY_PLANS[2]!)).toBeCloseTo(26.9249875, 4);
  });

  it("cost is usage at the blended rate plus the daily supply charge", () => {
    // A1: 278 kWh × 33.2621 c/kWh + 30 days × 119.2419 c/day = $128.24
    expect(planCost(SYNERGY_PLANS[0]!, 278, 30)).toBeCloseTo(128.24, 2);
    // Midday Saver: 278 × 28.215875 + 30 × 132.7806 = $118.27
    expect(planCost(SYNERGY_PLANS[1]!, 278, 30)).toBeCloseTo(118.27, 2);
    // EV Add On: 278 × 26.9249875 + 30 × 132.7806 = $114.69
    expect(planCost(SYNERGY_PLANS[2]!, 278, 30)).toBeCloseTo(114.69, 2);
  });

  it("time-of-use plans are cheaper than single rate at typical usage", () => {
    const saver = SYNERGY_PLANS[1]!;
    const flat = SYNERGY_PLANS[0]!;
    // At equal usage the ToU blended rate is ~5 c/kWh lower, but the supply charge
    // is ~13.5 c/day higher, so Midday Saver only wins above ~80 kWh/month.
    expect(planCost(saver, 280, 30)).toBeLessThan(planCost(flat, 280, 30));
    expect(planCost(saver, 50, 30)).toBeGreaterThan(planCost(flat, 50, 30));
  });
});
