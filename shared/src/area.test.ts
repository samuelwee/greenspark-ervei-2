import { describe, expect, it } from "vitest";
import { AREA_SIGNAL_ID, IRSD, areaSignal } from "./area";
import { evaluateCase } from "./caseFlow";
import type { FlowDoc } from "./flow";
import type { Person, QueueCase } from "./types";

// A tiny flowchart: one circumstance with two supporting signals, one of them the area signal.
const doc = {
  meta: { utilities: ["electricity"] }, circumstance_types: [{ id: "life" }], categories: [{ id: "money", name: "Money" }],
  signals: [
    { id: "area_disadvantage", name: "Lives in a disadvantaged area", source: "area", utilities: ["electricity"], points_to: [] },
    { id: "ask_concession_card", name: "Holds a concession card", source: "self_report", utilities: ["electricity"], points_to: [] },
    { id: "ask_trade_offs", name: "Bills vs food or medicine", source: "self_report", utilities: ["electricity"], points_to: [] },
  ],
  circumstances: [{ id: "low_fixed_income", name: "Low fixed income", category: "money", type: "life", sensitivity: "standard", utilities: ["electricity"], solutions: [],
    signals: [{ id: "area_disadvantage", strength: "supporting" }, { id: "ask_concession_card", strength: "supporting" }, { id: "ask_trade_offs", strength: "supporting" }] }],
  solutions: [],
} as unknown as FlowDoc;
const data = { asOf: "2026-10-16", evidenceFields: [] };
const person = (postcode: string) => ({ id: "p", address: { line1: "", line2: null, postcode } }) as unknown as Person;
const kase = (answers: Record<string, string | null>) => ({ id: "c", reportedAt: null, reportedAnswers: answers, workflow: { reviewStatus: "needs_review" } }) as unknown as QueueCase;

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

  it("never flags a circumstance, but adds its points once the customer's own evidence does", () => {
    const one = evaluateCase(kase({ Z7_8: "Yes" }), person("6064"), data, doc);
    expect(one.circumstances).toEqual([]); // area + one supporting signal is not enough
    const two = evaluateCase(kase({ Z7_8: "Yes", Q35_8: "Yes" }), person("6064"), data, doc);
    expect(two.circumstances[0]!.signals!.map((s) => s.id)).toContain(AREA_SIGNAL_ID);
    const elsewhere = evaluateCase(kase({ Z7_8: "Yes", Q35_8: "Yes" }), person("6011"), data, doc);
    expect(two.modelAssessment.priority!.score).toBeGreaterThan(elsewhere.modelAssessment.priority!.score);
  });
});
