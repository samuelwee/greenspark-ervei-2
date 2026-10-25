import { describe, expect, it } from "vitest";
import type { OutlookCustomer } from "../data/api";
import { customerOnDate, heatWarningActive, inMapRegion, regionalSupportAreas, supportAreas } from "./supportGroups";

const customer = (id: string, patch: Partial<OutlookCustomer> = {}): OutlookCustomer => ({
  personId: id, townId: "WA_PT012", tier: null, score: 0, exposure: 0,
  kinds: [], firstDate: null, firstKind: null, worst: null, sensitivity: [],
  accountNumber: `DEMO-${id}`, displayName: id, suburb: "Mandurah", postcode: "6210",
  risk: null, priority: null, status: "new", group: "health", ...patch,
});

describe("group map aggregation", () => {
  it("counts people once and never hides one urgent person in an area average", () => {
    const urgent = customer("urgent", { tier: "act" });
    const rows = Array.from({ length: 99 }, (_, i) => customer(String(i)));
    const result = supportAreas([...rows, urgent, urgent]);
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0]).toMatchObject({ count: 100, act: 1, monitor: 99, urgency: "urgent", groups: { health: 100 } });
    expect(result.areas[0]!.customers[0]!.personId).toBe("urgent");
  });
  it("reports unplaced records and combines selected groups without duplicating geography", () => {
    const result = supportAreas([customer("health"), customer("supply", { group: "supply" }), customer("missing", { postcode: "9999" })]);
    expect(result.unplaced).toBe(1);
    expect(result.areas[0]).toMatchObject({ count: 2, groups: { health: 1, supply: 1 } });
  });
  it("keeps action colours separate at a shared postcode and at regional zoom without double counting", () => {
    const { areas } = supportAreas([customer("a"), customer("b", { group: "supply" }), customer("c", { postcode: "6168", group: "health" })], true);
    expect(areas).toHaveLength(3);
    expect(new Set(areas.map((area) => area.id)).size).toBe(3);
    const regional = regionalSupportAreas(areas, 4);
    expect(regional).toHaveLength(2);
    expect(regional.find((area) => area.group === "health")?.count).toBe(2);
    expect(regional.find((area) => area.group === "supply")?.count).toBe(1);
    expect(regional.reduce((sum, area) => sum + area.count, 0)).toBe(3);
  });
  it("changes attention with the selected day and does not carry future urgency into missing days", () => {
    const person = customer("one", { tier: "act", exposure: 3, daily: [{ date: "2026-10-26", tier: "watch", exposure: 1, score: 5 }] });
    expect(customerOnDate(person, "")).toBe(person);
    expect(customerOnDate(person, "2026-10-26")).toMatchObject({ tier: "watch", exposure: 1 });
    expect(customerOnDate(person, "2026-10-30")).toMatchObject({ tier: null, exposure: 0 });
  });
  it("uses geographic region boundaries and explicit warning expiry in Perth time", () => {
    expect(inMapRegion(customer("mandurah"), "perth")).toBe(true);
    expect(inMapRegion(customer("broome", { postcode: "6725" }), "perth")).toBe(false);
    expect(inMapRegion(customer("unknown", { postcode: null }), "wa")).toBe(true);
    expect(heatWarningActive("2026-10-29T00:00:00Z", "2026-10-29")).toBe(true);
    expect(heatWarningActive("2026-10-29T00:00:00Z", "2026-10-30")).toBe(false);
  });
  it("conserves people and urgent attention in a regional overview, and restores each postcode when zoomed in", () => {
    const { areas } = supportAreas([customer("one", { tier: "act" }), customer("two", { postcode: "6168", suburb: "Rockingham" })]);
    const regional = regionalSupportAreas(areas, 4);
    expect(regional).toHaveLength(1);
    expect(regional[0]).toMatchObject({ count: 2, act: 1, urgency: "urgent" });
    expect(regional[0]!.parts).toHaveLength(2);
    expect(regionalSupportAreas(areas, 10)).toHaveLength(2);
  });
});
