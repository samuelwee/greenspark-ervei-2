import { describe, expect, it } from "vitest";
import { MAX_BULK_ITEMS } from "@greenspark/shared";
import { addSelection } from "./selection";

const selectedCases = (count: number) => new Map(Array.from({ length: count }, (_, i) => [`GS-${i}`, 1]));

describe("atomic bulk selection limit (#7)", () => {
  it("adds only the remaining capacity from the final page and preserves existing selections", () => {
    const current = selectedCases(MAX_BULK_ITEMS - 1);
    const result = addSelection(current, [MAX_BULK_ITEMS, MAX_BULK_ITEMS + 1, MAX_BULK_ITEMS + 2].map((id) => ({ caseId: `GS-${id}`, expectedVersion: 2 })));
    expect(result.limited).toBe(true);
    expect(result.selected.size).toBe(MAX_BULK_ITEMS);
    expect(result.selected.get(`GS-${MAX_BULK_ITEMS}`)).toBe(2);
    expect(result.selected.has(`GS-${MAX_BULK_ITEMS + 1}`)).toBe(false);
    expect(result.selected.has(`GS-${MAX_BULK_ITEMS + 2}`)).toBe(false);
    expect(current.size).toBe(MAX_BULK_ITEMS - 1);
  });

  it("refuses the next case once the limit is reached, without dropping any existing case", () => {
    const current = selectedCases(MAX_BULK_ITEMS);
    const result = addSelection(current, [{ caseId: "GS-new", expectedVersion: 1 }]);
    expect(result.limited).toBe(true);
    expect(result.selected).toEqual(current);
  });

  it("can refresh already-selected rows at the limit without counting them twice", () => {
    const result = addSelection(selectedCases(MAX_BULK_ITEMS), [{ caseId: "GS-0", expectedVersion: 7 }]);
    expect(result.limited).toBe(false);
    expect(result.selected.size).toBe(MAX_BULK_ITEMS);
    expect(result.selected.get("GS-0")).toBe(7);
  });
});
