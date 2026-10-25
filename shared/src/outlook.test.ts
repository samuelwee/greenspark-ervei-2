import { describe, expect, it } from "vitest";
import { customerOutlook, townHazards } from "./outlook";
import type { Person } from "./types";
import type { WeatherSnapshot } from "./weather";

const today = "2026-10-23";
function snapshot(max: number, patch: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    fetchedAt: "2026-10-23T06:00:00Z", issuedAt: null, demo: false, districts: { WA_PW009: "Lower West" },
    towns: { WA_PT053: { name: "Perth", district: "WA_PW009", days: [{ date: "2026-10-22", max: 45, min: 20, precis: "" }, { date: "2026-10-25", max, min: 20, precis: "" }] } },
    fireDanger: {}, warnings: [], ...patch,
  };
}
const person = (signals: string[], postcode = "6000") => ({
  id: "p1", displayName: "Test Person", suburb: "Perth", address: { line1: "", line2: null, postcode },
  signalSummary: { account: signals.filter((s) => s.startsWith("acct_")).map((id) => ({ id, evidence: "" })), selfReport: signals.filter((s) => s.startsWith("ask_")).map((id) => ({ id, evidence: "" })), northOf26th: false },
}) as unknown as Person;
const tier = (signals: string[], max: number, highRisk = false, patch?: Partial<WeatherSnapshot>) => customerOutlook(person(signals), snapshot(max, patch), today, highRisk)?.tier ?? null;

describe("weather outlook", () => {
  it("grades heat from the forecast maximum, ignoring past days", () => {
    expect(townHazards(snapshot(30), "WA_PT053", false, today)).toEqual([]); // the 45°C day was yesterday
    expect(townHazards(snapshot(35), "WA_PT053", false, today).map((h) => [h.kind, h.severity])).toEqual([["hot", 1]]);
    expect(townHazards(snapshot(38), "WA_PT053", false, today).map((h) => [h.kind, h.severity])).toEqual([["heat", 3]]);
    expect(townHazards(snapshot(41), "WA_PT053", false, today).map((h) => [h.kind, h.severity])).toEqual([["heat", 4]]);
    expect(townHazards(snapshot(41), "WA_PT053", true, today).map((h) => h.kind)).toEqual(["hot"]); // the north's limit is 42°C
  });

  it("puts health and supply needs in dangerous weather on act now", () => {
    expect(tier(["ask_illness"], 39)).toBe("act");
    expect(tier(["acct_disconnection_warning"], 39)).toBe("act");
    expect(tier(["ask_illness"], 35)).toBe("watch"); // only a hot day
    expect(tier(["acct_life_support"], 35)).toBe("act"); // a hot day is enough on life support
  });

  it("leaves out a concession card alone, and anyone without hot weather", () => {
    expect(tier(["acct_concession_on_file"], 39)).toBe(null);
    expect(tier(["acct_concession_on_file", "acct_rising_arrears"], 39)).toBe("watch");
    expect(tier(["acct_life_support"], 30)).toBe(null);
    expect(tier([], 39, true)).toBe("watch"); // high predicted risk
  });

  it("counts relevant warnings for the district and skips postcodes without a forecast town", () => {
    const warned = { warnings: [{ id: "W1", title: "Severe Heatwave Warning for Lower West", districts: ["WA_PW009"], expires: null }] };
    expect(tier(["ask_older"], 25, false, warned)).toBe("act");
    expect(customerOutlook(person(["ask_older"], "9999"), snapshot(40), today, false)).toBe(null);
  });

  it("evaluates a single day without importing later heat, and drops expired warnings", () => {
    const forecast = snapshot(41, { warnings: [{ id: "W1", title: "Severe Heatwave Warning", districts: ["WA_PW009"], expires: "2026-10-23T16:00:00Z" }] });
    expect(customerOutlook(person(["acct_life_support"]), forecast, "2026-10-23", false, 0, "2026-10-23")?.tier).toBe("act");
    expect(customerOutlook(person(["acct_life_support"]), forecast, "2026-10-24", false, 0, "2026-10-24")?.tier).toBe(null);
    expect(customerOutlook(person(["acct_life_support"]), forecast, "2026-10-25", false, 0, "2026-10-25")?.tier).toBe("act");
  });
});
