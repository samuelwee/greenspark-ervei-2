import { afterEach, describe, expect, it } from "vitest";
import { start, type Harness } from "./helpers";

describe("reset case data", () => {
  let h: Harness;
  afterEach(async () => { await h.stop(); });

  it("puts every case back to the fixture without reseeding people", async () => {
    h = await start();
    const before = h.store.allCases().map((c) => ({ id: c.id, status: c.workflow.status, notes: c.workflow.notes.length, version: c.version }));
    const people = h.store.allPeople().length;
    const first = h.store.allCases()[0]!;
    h.store.updateWorkflow(first.id, { status: first.workflow.status === "resolved" ? "open" : "resolved" }, "2026-10-30T00:00:00.000Z");
    h.store.addNote({ id: "n-reset-test", caseId: first.id, authorUserId: "staff-manager", text: "temp", createdAt: "2026-10-30T00:00:00.000Z" });

    const res = await h.call("staff-manager", "POST", "/api/admin/reset-cases");
    expect(res.status).toBe(200);

    expect(h.store.allPeople().length).toBe(people);
    expect(h.store.allCases().map((c) => ({ id: c.id, status: c.workflow.status, notes: c.workflow.notes.length, version: c.version }))).toEqual(before);
  });
});
