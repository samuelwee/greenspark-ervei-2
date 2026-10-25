import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { start, TestClock, type Harness } from "./helpers";

const SOURCE = new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url);
let dir: string;
let file: string;
let h: Harness;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gs-flow-"));
  file = join(dir, "flow.json");
  copyFileSync(SOURCE, file);
  h = await start(":memory:", new TestClock(), { flowFile: file });
});
afterEach(async () => {
  await h.stop();
  rmSync(dir, { recursive: true, force: true });
});

const M = "staff-manager";
const onDisk = () => JSON.parse(readFileSync(file, "utf8"));
const bytes = () => readFileSync(file, "utf8");
const post = (ops: unknown[], user = M) => h.call(user, "POST", "/api/admin/flow/ops", { ops });

describe("reading the flow", () => {
  it("needs a demo user, and is open to every one of them", async () => {
    expect((await h.call(null, "GET", "/api/admin/flow")).status).toBe(401);
    for (const user of ["staff-manager", "staff-alex", "staff-maya"]) {
      const r = await h.call(user, "GET", "/api/admin/flow");
      expect(r.status).toBe(200);
      expect(r.body.problems).toEqual([]);
      expect(r.body.doc.meta.counts).toEqual({ signals: 111, circumstances: 99, solutions: 49, links: 521 });
      expect(r.body.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("returns 404 when no flow file is configured", async () => {
    const bare = await start();
    expect((await bare.call(M, "GET", "/api/admin/flow")).status).toBe(404);
    expect((await bare.call(M, "POST", "/api/admin/flow/ops", { ops: [{ type: "batch", ops: [] }] })).status).toBe(404);
    await bare.stop();
  });
});

describe("editing writes straight to the JSON file", () => {
  it("changes only what was edited, in both directions of a link", async () => {
    const before = bytes();
    const r = await post([{ type: "setLink", signalId: "ask_lost_job", circumstanceId: "job_loss", strength: "supporting" }]); // was strong
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    const doc = onDisk();
    expect(doc.circumstances.find((c: any) => c.id === "job_loss").signals.find((l: any) => l.id === "ask_lost_job").strength).toBe("supporting");
    expect(doc.signals.find((s: any) => s.id === "ask_lost_job").points_to.find((l: any) => l.id === "job_loss").strength).toBe("supporting");
    expect(doc.meta.counts.links).toBe(521);
    // Only the two strength lines differ from the original file.
    const a = before.split("\n"), b = bytes().split("\n");
    expect(b.length).toBe(a.length);
    expect(b.filter((line, i) => line !== a[i]).length).toBe(2);
  });

  it("adds a new link in both directions and counts it", async () => {
    await post([{ type: "setLink", signalId: "acct_missed_payment", circumstanceId: "cost_of_living", strength: "strong" }]);
    const doc = onDisk();
    expect(doc.circumstances.find((c: any) => c.id === "cost_of_living").signals.some((l: any) => l.id === "acct_missed_payment")).toBe(true);
    expect(doc.signals.find((s: any) => s.id === "acct_missed_payment").points_to.some((l: any) => l.id === "cost_of_living")).toBe(true);
    expect(doc.meta.counts.links).toBe(522);
  });

  it("works for any demo user and renames a node", async () => {
    const r = await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "Lost my job" } }], "staff-alex");
    expect(r.status).toBe(200);
    expect(onDisk().signals.find((s: any) => s.id === "ask_lost_job").name).toBe("Lost my job");
    expect((await h.call("staff-maya", "GET", "/api/admin/flow")).body.doc.signals.find((s: any) => s.id === "ask_lost_job").name).toBe("Lost my job");
  });

  it("adds and deletes nodes, updating counts and links", async () => {
    await post([{ type: "addEntity", kind: "solution", entity: { id: "new_help", name: "New help", used_for: ["job_loss"] } }]);
    let doc = onDisk();
    expect(doc.meta.counts).toMatchObject({ solutions: 50, links: 522 });
    expect(doc.circumstances.find((c: any) => c.id === "job_loss").solutions).toContain("new_help");
    await post([{ type: "deleteEntity", kind: "solution", id: "new_help" }]);
    doc = onDisk();
    expect(doc.meta.counts).toMatchObject({ solutions: 49, links: 521 });
    expect(bytes()).toBe(readFileSync(SOURCE, "utf8").trimEnd().replace(/\s+$/, "")); // back to exactly the original
  });

  it("reports whether the file changed, and chains fingerprints", async () => {
    const start = (await h.call(M, "GET", "/api/admin/flow")).body.hash;
    const first = (await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "A" } }])).body;
    expect(first.previousHash).toBe(start);
    expect(first.hash).not.toBe(start);
    expect((await h.call(M, "GET", "/api/admin/flow")).body.hash).toBe(first.hash);
    const second = (await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "A" } }])).body; // same value again
    expect(second).toEqual({ hash: first.hash, previousHash: first.hash, changed: false });
  });

  it("leaves no temporary files behind", async () => {
    await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "B" } }]);
    expect(readdirSync(dir)).toEqual(["flow.json"]);
  });
});

describe("refusing bad edits", () => {
  it("rejects invalid values and leaves the file untouched", async () => {
    const before = bytes();
    for (const op of [
      { type: "updateEntity", kind: "solution", id: "payment_extension", patch: { source_url: "javascript:alert(1)" } },
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "" } },
      { type: "updateEntity", kind: "signal", id: "missing", patch: { name: "x" } },
      { type: "addEntity", kind: "signal", entity: { id: "job_loss", name: "Clash" } },
      { type: "deleteCategory", id: "income" },
    ]) {
      const r = await post([op]);
      expect(r.status, JSON.stringify(op)).toBe(422);
      expect(r.body.error.code).toBe("validation_failed");
      expect(bytes()).toBe(before);
    }
  });

  it("applies a group of edits all or nothing", async () => {
    const before = bytes();
    const r = await post([
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "Changed" } },
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { source: "rumour" } },
    ]);
    expect(r.status).toBe(422);
    expect(bytes()).toBe(before);
    const ok = await post([
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "One" } },
      { type: "updateEntity", kind: "signal", id: "ask_less_hours", patch: { name: "Two" } },
    ]);
    expect(ok.status).toBe(200);
    const doc = onDisk();
    expect([doc.signals.find((s: any) => s.id === "ask_lost_job").name, doc.signals.find((s: any) => s.id === "ask_less_hours").name]).toEqual(["One", "Two"]);
  });

  it("validates the request itself", async () => {
    const before = bytes();
    expect((await h.call(M, "POST", "/api/admin/flow/ops", {})).status).toBe(422);
    expect((await h.call(M, "POST", "/api/admin/flow/ops", { ops: [] })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/admin/flow/ops", { ops: [{ type: "explode" }] })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/admin/flow/ops", { ops: [{ type: "setLink", signalId: 5 }] })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/admin/flow/ops", { ops: [{ type: "batch", ops: [] }], extra: 1 })).status).toBe(422);
    expect((await h.call(M, "POST", "/api/admin/flow/ops", { ops: Array.from({ length: 201 }, () => ({ type: "batch", ops: [] })) })).status).toBe(422);
    expect(bytes()).toBe(before);
  });
});

describe("a file that is edited outside the app", () => {
  it("is picked up straight away and kept by later edits", async () => {
    const doc = onDisk();
    doc.signals.find((s: any) => s.id === "ask_lost_job").name = "Edited by hand";
    writeFileSync(file, JSON.stringify(doc, null, 2));
    expect((await h.call(M, "GET", "/api/admin/flow")).body.doc.signals.find((s: any) => s.id === "ask_lost_job").name).toBe("Edited by hand");
    await post([{ type: "updateEntity", kind: "signal", id: "ask_less_hours", patch: { name: "Via the app" } }]);
    const after = onDisk();
    expect(after.signals.find((s: any) => s.id === "ask_lost_job").name).toBe("Edited by hand");
    expect(after.signals.find((s: any) => s.id === "ask_less_hours").name).toBe("Via the app");
  });

  it("is reported, not crashed on, when it is broken", async () => {
    writeFileSync(file, "{ not json");
    const r = await h.call(M, "GET", "/api/admin/flow");
    expect(r.status).toBe(200);
    expect(r.body.doc).toBeNull();
    expect(r.body.problems[0]).toMatch(/not valid JSON/);
    const edit = await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "x" } }]);
    expect(edit.status).toBe(422);
    expect(edit.body.error.message).toMatch(/problems/);
    expect(bytes()).toBe("{ not json"); // never overwritten

    const doc = JSON.parse(readFileSync(SOURCE, "utf8"));
    doc.circumstances[0].signals.push({ id: "ghost", strength: "strong" });
    writeFileSync(file, JSON.stringify(doc, null, 2));
    const damaged = await h.call(M, "GET", "/api/admin/flow");
    expect(damaged.body.problems.join(" ")).toMatch(/which is not a signal/);
    expect((await post([{ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "x" } }])).status).toBe(422);
  });

  it("is fixed up when the two directions of a link disagree", async () => {
    const doc = onDisk();
    doc.signals.find((s: any) => s.id === "ask_lost_job").points_to = []; // derived list out of date
    writeFileSync(file, JSON.stringify(doc, null, 2));
    const read = await h.call(M, "GET", "/api/admin/flow");
    expect(read.body.problems).toEqual([]);
    expect(read.body.doc.signals.find((s: any) => s.id === "ask_lost_job").points_to).toHaveLength(1);
    await post([{ type: "updateEntity", kind: "signal", id: "ask_less_hours", patch: { name: "Touch" } }]);
    expect(onDisk().signals.find((s: any) => s.id === "ask_lost_job").points_to).toHaveLength(1); // repaired on the next save
  });
});

describe("several people saving at once", () => {
  it("never loses an edit", async () => {
    const circumstances = onDisk().circumstances.slice(0, 12).map((c: any) => c.id);
    const results = await Promise.all(circumstances.map((id: string, i: number) => post([{ type: "updateEntity", kind: "circumstance", id, patch: { name: `Renamed ${i}` } }], i % 2 ? "staff-alex" : M)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const doc = onDisk();
    circumstances.forEach((id: string, i: number) => expect(doc.circumstances.find((c: any) => c.id === id).name).toBe(`Renamed ${i}`));
    expect(readdirSync(dir)).toEqual(["flow.json"]);
  });
});
