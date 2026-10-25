import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FlowDoc } from "@greenspark/shared";
import { buildIndex, groupCircumstances, groupSignals, groupSolutions, nodeKey, search, trace } from "./flowModel";

const doc = JSON.parse(readFileSync(new URL("../../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc;
const idx = buildIndex(doc);

describe("flow model", () => {
  it("builds every link from the circumstances", () => {
    expect(idx.links).toHaveLength(521);
    expect(idx.links.filter((l) => l.strength === "strong")).toHaveLength(108);
    expect(idx.links.filter((l) => l.strength === "supporting")).toHaveLength(128);
    expect(idx.circumstancesOfSignal.get("ask_lost_job")).toEqual([{ id: "job_loss", strength: "strong" }]);
    expect(idx.circumstancesOfSolution.get("fdv_helplines")).toEqual(expect.arrayContaining(["family_violence", "economic_abuse", "elder_abuse"]));
  });

  it("traces the path through a signal, a circumstance and a solution", () => {
    const c = trace(idx, { kind: "circumstance", id: "job_loss" });
    expect(c.nodes.has(nodeKey("signal", "ask_lost_job"))).toBe(true);
    expect(c.nodes.has(nodeKey("solution", "payment_extension"))).toBe(true);
    expect(c.links.size).toBe(4 + 8); // 4 signals and 8 solutions
    const s = trace(idx, { kind: "signal", id: "ask_lost_job" });
    expect(s.nodes.has(nodeKey("circumstance", "job_loss"))).toBe(true);
    expect(s.nodes.has(nodeKey("solution", "hugs"))).toBe(true);
    expect(s.nodes.has(nodeKey("signal", "acct_missed_payment"))).toBe(false); // siblings are not on this signal's path
    const o = trace(idx, { kind: "solution", id: "payment_extension" });
    expect(o.nodes.has(nodeKey("circumstance", "job_loss"))).toBe(true);
    expect(o.nodes.has(nodeKey("signal", "ask_lost_job"))).toBe(true);
    expect(o.nodes.has(nodeKey("solution", "hugs"))).toBe(false);
  });

  it("groups each lane and respects the utility filter", () => {
    expect(groupSignals(doc, "all").map((g) => [g.id, g.items.length])).toEqual([["account", 50], ["self_report", 57], ["weather", 3], ["area", 1]]);
    expect(groupCircumstances(doc, "all")).toHaveLength(14);
    expect(groupSolutions(doc, "all").reduce((n, g) => n + g.items.length, 0)).toBe(49);
    const telco = groupSignals(doc, "telco").reduce((n, g) => n + g.items.length, 0);
    expect(telco).toBeLessThan(111);
    expect(groupSignals(doc, "telco").every((g) => g.items.every((s) => s.utilities.includes("telco")))).toBe(true);
  });

  it("searches names first, then other text", () => {
    const hits = search(doc, "job");
    expect(hits[0]!.name.toLowerCase()).toContain("job");
    expect(search(doc, "zzzz")).toEqual([]);
    expect(search(doc, "  ")).toEqual([]);
    expect(search(doc, "synergy").some((h) => h.ref.kind === "solution")).toBe(true);
    expect(search(doc, "a").length).toBeLessThanOrEqual(12);
  });
});
