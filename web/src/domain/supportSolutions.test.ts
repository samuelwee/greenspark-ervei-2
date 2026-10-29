import { describe, expect, it } from "vitest";
import type { OutlookCustomer } from "../data/api";
import { buildSolutionPlan } from "./supportSolutions";
const row = (id: string, group: OutlookCustomer["group"], needs: OutlookCustomer["supportNeeds"]): OutlookCustomer => ({ personId: id, group, supportNeeds: needs, townId: "test", tier: null, score: 0, exposure: 0, kinds: [], firstDate: null, firstKind: null, worst: null, sensitivity: [], accountNumber: null, displayName: id, suburb: "Test", postcode: "6000", risk: null, priority: null, status: "new" });
describe("group solutions", () => {
  it("deduplicates the same solution across primary groups and retains distinct solutions", () => {
    const a = row("a", "health", ["health", "bills"]), b = row("b", "supply", ["supply", "bills"]), c = row("c", "bills", ["bills"]);
    const plan = buildSolutionPlan([a, a, b, c], ["health", "supply", "bills"]);
    expect(plan.shared.find((entry) => entry.id === "hardship")?.customers.map((x) => x.personId)).toEqual(["a", "b", "c"]);
    expect(plan.cards[0]!.own.map((entry) => entry.id)).toEqual(["cooling"]);
    expect(plan.cards[1]!.own.map((entry) => entry.id)).toEqual(["supply"]);
    expect(plan.cards[2]!.own).toEqual([]);
    expect(plan.cards[0]!.secondary).toEqual([expect.objectContaining({ id: "bills", count: 1 })]);
  });
  it("removes inactive groups and moves a formerly shared solution into its remaining group", () => {
    const plan = buildSolutionPlan([row("a", "health", ["health", "bills"]), row("b", "bills", ["bills"])], ["health", "coaching"]);
    expect(plan.shared).toEqual([]);
    expect(plan.cards[0]!.own.find((entry) => entry.id === "hardship")?.customers).toHaveLength(1);
    expect(plan.cards[1]!.members).toEqual([]);
  });
});
