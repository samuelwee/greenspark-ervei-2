import { describe, expect, it } from "vitest";
import { primarySupportGroup, supportGroupNeeds, supportMarkerRadius, supportUrgency } from "./supportGroups";

describe("primary support action", () => {
  it("keeps an interrupted supply first while retaining health needs on the case", () => {
    expect(primarySupportGroup([{ id: "acct_life_support", group: "health" }, { id: "acct_disconnected", group: "supply" }])).toBe("supply");
    expect(primarySupportGroup([{ id: "acct_prepay_low_credit", group: "supply" }, { id: "acct_missed_payment", group: "cost" }])).toBe("supply");
  });
  it("uses recorded needs in a deterministic order, with one primary group", () => {
    expect(primarySupportGroup([{ id: "acct_life_support", group: "health" }, { id: "acct_disconnection_warning", group: "supply" }])).toBe("health");
    expect(primarySupportGroup([{ id: "acct_disconnection_warning", group: "supply" }])).toBe("supply");
    expect(primarySupportGroup([{ id: "ask_rationing", group: "cost" }])).toBe("bills");
    expect(primarySupportGroup([{ id: "acct_remote_area", group: "isolation" }])).toBe("monitor");
    expect(primarySupportGroup([])).toBe("monitor");
  });
  it("separates volume from urgency and keeps symbols readable and bounded", () => {
    expect(supportMarkerRadius(36) ** 2 / supportMarkerRadius(9) ** 2).toBe(4);
    expect(supportMarkerRadius(10000)).toBeLessThanOrEqual(34);
    expect(supportMarkerRadius(1)).toBeGreaterThanOrEqual(9);
    expect(supportMarkerRadius(100)).toBeGreaterThan(supportMarkerRadius(5));
    expect(supportUrgency("act")).toBe("urgent");
    expect(supportUrgency("watch")).toBe("review");
    expect(supportUrgency(null)).toBe("monitor");
  });
  it("uses concession and usage signals outside the weather subset while retaining secondary needs", () => {
    const signals = [{ id: "acct_concession_lapsed" }, { id: "acct_broken_plan" }, { id: "acct_usage_spike" }];
    expect(primarySupportGroup(signals)).toBe("concessions");
    expect(supportGroupNeeds(signals)).toEqual(["bills", "concessions", "coaching"]);
    expect(primarySupportGroup([{ id: "acct_usage_spike" }])).toBe("coaching");
    expect(primarySupportGroup([{ id: "acct_broken_plan" }])).toBe("bills");
    expect(primarySupportGroup([{ id: "acct_concession_on_file", group: "cost" }])).toBe("monitor");
    expect(primarySupportGroup([{ id: "acct_life_support", group: "health" }, ...signals])).toBe("health");
    expect(primarySupportGroup([{ id: "ask_concession_card" }])).toBe("concessions");
    expect(primarySupportGroup([{ id: "ask_concession_card" }, { id: "acct_concession_on_file", group: "cost" }])).toBe("monitor");
    expect(primarySupportGroup([{ id: "ask_bill_higher" }])).toBe("coaching");
  });
});
