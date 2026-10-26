import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actualRule } from "./signalRules";
import { signalHasData } from "./caseFlow";
import type { FlowDoc } from "./flow";

const doc = JSON.parse(readFileSync(new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8")) as FlowDoc;

describe("the rule each signal is detected by", () => {
  it("is described for every signal the app has data for, and for no other", () => {
    for (const s of doc.signals) expect(actualRule(s) !== null, s.id).toBe(signalHasData(s));
  });

  it("quotes the phrases and survey answers the code actually matches", () => {
    const lostJob = doc.signals.find((s) => s.id === "ask_lost_job")!;
    expect(actualRule(lostJob)).toContain('"lost my job"');
    const rationing = doc.signals.find((s) => s.id === "ask_rationing")!;
    expect(actualRule(rationing)).toContain("Q35_3");
    expect(actualRule(rationing)).toContain('"sitting in the dark"');
  });
});
