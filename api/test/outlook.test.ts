import { afterEach, describe, expect, it } from "vitest";
import { POSTCODE_TOWN, sampleWeather } from "@greenspark/shared";
import { start, type Harness } from "./helpers";

let h: Harness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

describe("weather outlook", () => {
  it("lists the customers the sample heatwave puts at risk, act now first", async () => {
    const snapshot = sampleWeather("2026-10-16");
    h = await start(":memory:", undefined, { weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const { status, body } = await h.call("staff-manager", "GET", "/api/outlook");
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.days).toHaveLength(7);
    expect(body.totals.act).toBeGreaterThan(0);
    expect(body.customers.length).toBe(body.totals.act + body.totals.watch);
    // The funnel narrows at every stage.
    const t = body.totals;
    expect([t.covered + t.uncovered, t.covered, t.exposed, t.vulnerable, t.act + t.watch, t.act]).toEqual([...[t.covered + t.uncovered, t.covered, t.exposed, t.vulnerable, t.act + t.watch, t.act]].sort((a, b) => b - a));
    const tiers = body.customers.map((c: any) => c.tier);
    expect(tiers.indexOf("watch") === -1 || tiers.lastIndexOf("act") < tiers.indexOf("watch")).toBe(true);
    const perth = body.towns.find((t: any) => t.name === "Perth");
    expect(perth.hazards.some((x: any) => x.kind === "heat")).toBe(true);
    expect(body.towns.find((t: any) => t.name === "Broome").act).toBe(0); // the sample heatwave is in the south
  });

  it("is worked out once, and again when a case changes", async () => {
    const snapshot = sampleWeather("2026-10-16");
    h = await start(":memory:", undefined, { weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const first = (await h.call("staff-manager", "GET", "/api/outlook")).body;
    expect((await h.call("staff-manager", "GET", "/api/outlook")).body).toEqual(first);
    const row = first.customers[0];
    const c = h.store.getCaseForPerson(row.personId)!;
    const next = c.workflow.status === "waiting" ? "in_progress" : "waiting";
    expect((await h.call("staff-manager", "POST", "/api/cases/bulk/status", { status: next, items: [{ caseId: c.id, expectedVersion: c.version }] })).status).toBe(200);
    const after = (await h.call("staff-manager", "GET", "/api/outlook")).body;
    expect(after.customers.find((x: any) => x.personId === row.personId).status).toBe(next);
  });

  it("adds long-term heat to the outlook's towns and the case page's forecast", async () => {
    const snapshot = sampleWeather("2026-10-16");
    const postcodes = Object.fromEntries(Object.entries(POSTCODE_TOWN).map(([pc, town]) => [pc, { hot: 10, veryHot: 1, summerMax: 31, hot2050: 16, veryHot2050: 3, town }]));
    const climate = { id: "test", thresholds: { hot: 35, veryHot: 40 }, baseline: { source: "SILO", years: [1995, 2024] as [number, number], licence: "CC BY 4.0" },
      projection: { source: "CMIP6", scenario: "SSP2-4.5", period: "2035-2064", models: ["A"], method: "", licence: "CC BY 4.0" }, postcodes };
    h = await start(":memory:", undefined, { climate, weather: { current: () => snapshot, status: () => ({ mode: "demo" }), setMode: async () => undefined } });
    const outlook = (await h.call("staff-manager", "GET", "/api/outlook")).body;
    expect(outlook.climate.scenario).toBe("SSP2-4.5");
    expect(outlook.towns.find((t: any) => t.name === "Perth").climate).toEqual({ hot: 10, hot2050: 16, veryHot: 1, veryHot2050: 3 });
    const account = outlook.customers[0].accountNumber;
    const c = (await h.call("staff-manager", "GET", `/api/accounts/${account}`)).body;
    expect(c.forecast.climate).toMatchObject({ hot: 10, hot2050: 16, period: "2035-2064" });
  });

  it("says when there is no forecast", async () => {
    h = await start();
    const { body } = await h.call("staff-manager", "GET", "/api/outlook");
    expect(body.available).toBe(false);
  });
});
