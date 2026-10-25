// One-off: adds the ABS SEIFA area-disadvantage signal to the flowchart file and links it to circumstances.
// Safe to run again: a signal or link that already exists is left as it is, and other edits are kept.
// Usage: npx tsx scripts/add-area-signal.mts [path]  (default: data/admin/utility_hardship_mapping.json;
// on Fly, the live copy is /data/utility_hardship_mapping.json)
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeDoc, type FlowDoc } from "../shared/src/flow";

const path = process.argv[2] ?? new URL("../data/admin/utility_hardship_mapping.json", import.meta.url);
const doc = JSON.parse(readFileSync(path, "utf8")) as FlowDoc;

if (!doc.signals.some((s) => s.id === "area_disadvantage")) {
  doc.signals.push({
    id: "area_disadvantage", name: "Lives in a disadvantaged area", source: "area",
    detect: "The customer's postcode is among the most disadvantaged 20% in WA (ABS SEIFA 2021, Index of Relative Socio-economic Disadvantage, WA decile 1 or 2). It describes the area, not the person, so it never counts towards flagging a circumstance; it adds priority points once the customer's own evidence has flagged one.",
    example_rule: "irsd_wa_decile(postcode) <= 2",
    utilities: ["electricity", "gas", "water", "telco"], sensitive: false, points_to: [],
  });
}
// Supporting links; evaluateCase never counts area signals towards flagging, so they only add points.
for (const id of ["low_fixed_income", "cost_of_living", "renter_inefficient_home", "rationing"]) {
  const c = doc.circumstances.find((x) => x.id === id);
  if (!c) throw new Error(`No circumstance ${id}`);
  if (!c.signals.some((l) => l.id === "area_disadvantage")) c.signals.push({ id: "area_disadvantage", strength: "supporting" });
}
normalizeDoc(doc);
writeFileSync(path, JSON.stringify(doc, null, 2), "utf8");
console.log(doc.meta.counts);
