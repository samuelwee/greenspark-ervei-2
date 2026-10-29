import { describe, expect, it } from "vitest";
import { blendedRateCentsPerKwh, planCost, planForTariff, planHours, profileForCustomer, profileWeight, SYNERGY_PLANS, USAGE_PROFILES, UNIFORM_PROFILE } from "./plans";

const A1 = SYNERGY_PLANS[0]!;
const MIDDAY = SYNERGY_PLANS[1]!;
const EV = SYNERGY_PLANS[2]!;

describe("Synergy plan prices", () => {
  it("every plan's periods cover exactly 24 hours", () => {
    for (const p of SYNERGY_PLANS) expect(planHours(p)).toBe(24);
  });

  it("matches the account tariffs in the fixture", () => {
    expect(planForTariff("A1")?.name).toBe("Home Plan (A1)");
    expect(planForTariff("midday_saver")?.name).toBe("Midday Saver");
    expect(planForTariff("unknown_tariff")).toBeNull();
  });

  it("single-rate plans are exact regardless of profile", () => {
    for (const prof of USAGE_PROFILES) expect(planCost(A1, 278, 30, prof)).toBeCloseTo(128.24, 2);
  });
});

describe("usage profiles", () => {
  it("each profile's segments cover the day and have positive weight", () => {
    for (const prof of USAGE_PROFILES) {
      // Sum of segment hours is 24 (a [0, 24) segment counts as 24).
      const hours = prof.segments.reduce((s, seg) => {
        const d = ((seg.end - seg.start) % 24 + 24) % 24;
        return s + (d === 0 && seg.start !== seg.end ? 24 : d);
      }, 0);
      expect(hours, prof.id).toBe(24);
      expect(profileWeight(prof), prof.id).toBeGreaterThan(0);
    }
  });

  it("the uniform profile blends to the old even-through-the-day rates", () => {
    expect(blendedRateCentsPerKwh(A1, UNIFORM_PROFILE)).toBeCloseTo(33.2621, 4);
    // Midday: (6×55.3253 + 12×24.3431 + 6×8.8520) / 24
    expect(blendedRateCentsPerKwh(MIDDAY, UNIFORM_PROFILE)).toBeCloseTo(28.215875, 4);
    // EV: (6×55.3253 + 5×24.3431 + 6×8.8520 + 7×19.9172) / 24
    expect(blendedRateCentsPerKwh(EV, UNIFORM_PROFILE)).toBeCloseTo(26.9249875, 4);
  });

  it("profiles shift the blended rate toward their heavy-use hours", () => {
    // Nine-to-five (3x use 5:30pm-10pm, mostly peak): Midday blend rises above A1's flat rate.
    expect(blendedRateCentsPerKwh(MIDDAY, USAGE_PROFILES[0]!)).toBeCloseTo(33.7316, 4);
    // Works from home (2x use 8am-9pm, spread over super off peak and off peak): cheaper than flat.
    expect(blendedRateCentsPerKwh(MIDDAY, USAGE_PROFILES[1]!)).toBeCloseTo(29.3672, 4);
    // Night owl (2x use 8pm-3am, mostly off peak): cheapest of the three.
    expect(blendedRateCentsPerKwh(MIDDAY, USAGE_PROFILES[2]!)).toBeCloseTo(28.3408, 4);
  });

  it("cost follows the profile: 278 kWh and 30 days on Midday Saver", () => {
    // Nine-to-five pays more than the flat plan; the other two save.
    expect(planCost(MIDDAY, 278, 30, USAGE_PROFILES[0]!)).toBeCloseTo(133.61, 2);
    expect(planCost(MIDDAY, 278, 30, USAGE_PROFILES[1]!)).toBeCloseTo(121.48, 2);
    expect(planCost(MIDDAY, 278, 30, USAGE_PROFILES[2]!)).toBeCloseTo(118.62, 2);
    expect(planCost(MIDDAY, 278, 30, USAGE_PROFILES[0]!)).toBeGreaterThan(planCost(A1, 278, 30));
  });

  it("profileForCustomer is stable per customer id and picks a real profile", () => {
    const ids = ["demo-person-001", "demo-person-002", "demo-person-003", "C102360"];
    const profiles = ids.map((id) => profileForCustomer(id));
    for (const p of profiles) expect(USAGE_PROFILES.some((x) => x.id === p.id)).toBe(true);
    // Same id, same profile.
    expect(profileForCustomer("C102360").id).toBe(profiles[3]!.id);
    // The demo ids land on different profiles, so the queue shows all three.
    expect(new Set(profiles.map((p) => p.id)).size).toBe(3);
  });
});
