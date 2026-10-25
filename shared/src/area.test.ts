import { describe, expect, it } from "vitest";
import { AREA_SIGNAL_ID, IRSD, areaSignal } from "./area";

describe("area disadvantage (ABS SEIFA 2021)", () => {
  it("flags only the most disadvantaged 20% of WA postcodes", () => {
    expect(areaSignal("6064")?.id).toBe(AREA_SIGNAL_ID); // Girrawheen, WA decile 1
    expect(areaSignal("6168")?.id).toBe(AREA_SIGNAL_ID); // Rockingham, WA decile 2
    expect(areaSignal("6056")).toBeNull(); // Midland, WA decile 3
    expect(areaSignal("6011")).toBeNull(); // Cottesloe, WA decile 10
  });

  it("raises nothing for a missing or unknown postcode", () => {
    expect(areaSignal(null)).toBeNull();
    expect(areaSignal("9999")).toBeNull();
  });

  it("says where the evidence comes from", () => {
    expect(areaSignal("6064")!.evidence).toContain("ABS SEIFA 2021");
    for (const [score, au, wa] of Object.values(IRSD)) {
      expect(au).toBeGreaterThanOrEqual(1); expect(au).toBeLessThanOrEqual(10);
      expect(wa).toBeGreaterThanOrEqual(1); expect(wa).toBeLessThanOrEqual(10);
      expect(score).toBeGreaterThan(400);
    }
  });
});
