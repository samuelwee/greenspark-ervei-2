import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FlowError, applyOp, applyWithInverse, normalizeDoc, parseOp, slugId, validateDoc,
  type FlowCircumstance, type FlowDoc, type FlowOp, type FlowSignal, type FlowSolution,
} from "./flow";

const raw = readFileSync(new URL("../../data/admin/utility_hardship_mapping.json", import.meta.url), "utf8");
const original = JSON.parse(raw) as FlowDoc;
const fresh = () => structuredClone(original);

/** Order-insensitive form, so an edit followed by its undo can be compared even if list order shifts. */
function canon(doc: FlowDoc) {
  const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
  return {
    meta: doc.meta,
    types: byId(doc.circumstance_types), categories: byId(doc.categories),
    signals: byId(doc.signals).map((s) => ({ ...s, points_to: byId(s.points_to) })),
    circumstances: byId(doc.circumstances).map((c) => ({ ...c, signals: byId(c.signals), solutions: [...c.solutions].sort() })),
    solutions: byId(doc.solutions).map((s) => ({ ...s, used_for: [...s.used_for].sort() })),
  };
}
const listLength = (doc: FlowDoc, kind: "signal" | "circumstance" | "solution") => (kind === "signal" ? doc.signals : kind === "circumstance" ? doc.circumstances : doc.solutions).length;
const sig = (doc: FlowDoc, id: string) => doc.signals.find((s) => s.id === id)!;
const circ = (doc: FlowDoc, id: string) => doc.circumstances.find((c) => c.id === id)!;
const sol = (doc: FlowDoc, id: string) => doc.solutions.find((s) => s.id === id)!;

describe("the real file", () => {
  it("is valid and already consistent: normalising changes nothing", () => {
    expect(validateDoc(original)).toEqual([]);
    expect(JSON.stringify(normalizeDoc(fresh()), null, 2)).toBe(raw); // byte for byte, so the first save leaves no diff
    expect(original.meta.counts).toEqual({ signals: 111, circumstances: 99, solutions: 49, links: 521 });
  });
});

describe("links", () => {
  it("keep both directions in step", () => {
    const doc = applyOp(fresh(), { type: "setLink", signalId: "acct_missed_payment", circumstanceId: "cost_of_living", strength: "strong" });
    expect(circ(doc, "cost_of_living").signals.find((l) => l.id === "acct_missed_payment")?.strength).toBe("strong");
    expect(sig(doc, "acct_missed_payment").points_to.find((l) => l.id === "cost_of_living")).toEqual({ id: "cost_of_living", strength: "strong" });
    expect(doc.meta.counts.links).toBe(original.meta.counts.links + 1);
    const removed = applyOp(doc, { type: "removeSignalLink", signalId: "acct_missed_payment", circumstanceId: "cost_of_living" });
    expect(sig(removed, "acct_missed_payment").points_to.some((l) => l.id === "cost_of_living")).toBe(false);
    expect(removed.meta.counts.links).toBe(original.meta.counts.links);
  });

  it("can change a strength and link solutions", () => {
    let doc = applyOp(fresh(), { type: "setLink", signalId: "acct_missed_payment", circumstanceId: "job_loss", strength: "strong" });
    expect(sig(doc, "acct_missed_payment").points_to.find((l) => l.id === "job_loss")?.strength).toBe("strong");
    expect(doc.meta.counts.links).toBe(521);
    doc = applyOp(doc, { type: "addSolutionLink", circumstanceId: "job_loss", solutionId: "fdv_helplines" });
    expect(sol(doc, "fdv_helplines").used_for).toContain("job_loss");
    expect(circ(doc, "job_loss").solutions).toContain("fdv_helplines");
  });

  it("treat repeated or missing links as no change", () => {
    const again = applyWithInverse(fresh(), { type: "setLink", signalId: "ask_lost_job", circumstanceId: "job_loss", strength: "strong" });
    expect(canon(again.doc)).toEqual(canon(original));
    expect(again.inverse).toEqual({ type: "batch", ops: [] });
    expect(canon(applyOp(fresh(), { type: "removeSolutionLink", circumstanceId: "job_loss", solutionId: "fdv_helplines" }))).toEqual(canon(original));
  });

  it("reject unknown things", () => {
    expect(() => applyOp(fresh(), { type: "setLink", signalId: "nope", circumstanceId: "job_loss", strength: "strong" })).toThrow(FlowError);
    expect(() => applyOp(fresh(), { type: "setLink", signalId: "ask_lost_job", circumstanceId: "job_loss", strength: "huge" as never })).toThrow(/strength/);
    expect(() => applyOp(fresh(), { type: "addSolutionLink", circumstanceId: "job_loss", solutionId: "ask_lost_job" })).toThrow(/no solution/);
  });
});

describe("entities", () => {
  it("adds a signal with links in both directions", () => {
    const doc = applyOp(fresh(), { type: "addEntity", kind: "signal", entity: { id: "acct_new_signal", name: "  New signal ", points_to: [{ id: "job_loss", strength: "supporting" }] } });
    const added = sig(doc, "acct_new_signal");
    expect(added).toMatchObject({ name: "New signal", source: "account", sensitive: false, utilities: ["electricity", "gas", "water", "telco"] });
    expect(added.points_to).toEqual([{ id: "job_loss", strength: "supporting" }]);
    expect(circ(doc, "job_loss").signals.at(-1)).toEqual({ id: "acct_new_signal", strength: "supporting" });
    expect(doc.meta.counts).toMatchObject({ signals: 112, links: 522 });
  });

  it("adds a circumstance and a solution", () => {
    let doc = applyOp(fresh(), { type: "addEntity", kind: "circumstance", entity: { id: "new_barrier", name: "New barrier", type: "life", category: "income", signals: [{ id: "ask_lost_job", strength: "strong" }], solutions: ["payment_extension"] } });
    expect(sig(doc, "ask_lost_job").points_to.some((l) => l.id === "new_barrier")).toBe(true);
    expect(sol(doc, "payment_extension").used_for).toContain("new_barrier");
    doc = applyOp(doc, { type: "addEntity", kind: "solution", entity: { id: "new_help", name: "New help", type: "Referral", used_for: ["new_barrier"], source_url: "https://example.org/help", verified: true, last_verified: "2026-10-20" } });
    expect(circ(doc, "new_barrier").solutions).toEqual(["payment_extension", "new_help"]);
    expect(doc.meta.counts).toMatchObject({ circumstances: 100, solutions: 50 });
    expect(validateDoc(doc)).toEqual([]);
  });

  it("updates fields, trims text and keeps the id", () => {
    const doc = applyOp(fresh(), { type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { name: " Lost work ", sensitivity: "sensitive", handling: "  Be gentle.  " } });
    expect(circ(doc, "job_loss")).toMatchObject({ id: "job_loss", name: "Lost work", sensitivity: "sensitive", handling: "Be gentle." });
    const cleared = applyOp(doc, { type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { handling: "   " } });
    expect(circ(cleared, "job_loss").handling).toBeNull();
  });

  it("deletes with cascade", () => {
    const doc = applyOp(fresh(), { type: "deleteEntity", kind: "solution", id: "payment_extension" });
    expect(doc.solutions.some((s) => s.id === "payment_extension")).toBe(false);
    expect(doc.circumstances.some((c) => c.solutions.includes("payment_extension"))).toBe(false);
    expect(validateDoc(doc)).toEqual([]);
    const gone = applyOp(fresh(), { type: "deleteEntity", kind: "signal", id: "ask_lost_job" });
    expect(circ(gone, "job_loss").signals.some((l) => l.id === "ask_lost_job")).toBe(false);
    expect(gone.meta.counts.links).toBeLessThan(521);
  });

  it("refuses bad values", () => {
    const bad = (op: FlowOp, message: RegExp) => expect(() => applyOp(fresh(), op)).toThrow(message);
    bad({ type: "updateEntity", kind: "solution", id: "payment_extension", patch: { source_url: "javascript:alert(1)" } }, /http/);
    bad({ type: "updateEntity", kind: "solution", id: "payment_extension", patch: { source_url: "not a url" } }, /web address/);
    bad({ type: "updateEntity", kind: "solution", id: "payment_extension", patch: { last_verified: "yesterday" } }, /date/);
    expect(circ(applyOp(fresh(), { type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { handling: null } }), "job_loss").handling).toBeNull();
    expect(sol(applyOp(fresh(), { type: "updateEntity", kind: "solution", id: "payment_extension", patch: { source_url: "  " } }), "payment_extension").source_url).toBeNull(); // no link
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "   " } }, /empty/);
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { utilities: ["electricity", "sewage"] } }, /Unknown utility/);
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { utilities: [] } }, /at least one/);
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { source: "rumour" } }, /source/);
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { points_to: [] } }, /can't be edited/);
    bad({ type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { id: "other" } }, /can't be edited/);
    bad({ type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { type: "made_up" } }, /Unknown circumstance type/);
    bad({ type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { category: "made_up" } }, /Unknown category/);
    bad({ type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { sensitivity: "secret" } }, /sensitivity/);
    bad({ type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { name: "x".repeat(201) } }, /too long/);
    bad({ type: "updateEntity", kind: "signal", id: "missing", patch: { name: "x" } }, /no signal/);
    bad({ type: "addEntity", kind: "signal", entity: { id: "job_loss", name: "Clash" } }, /already used/);
    bad({ type: "addEntity", kind: "signal", entity: { id: "Bad Id!", name: "x" } }, /id must be/);
    bad({ type: "addEntity", kind: "signal", entity: { id: "fresh_one" } }, /empty/);
    bad({ type: "addEntity", kind: "signal", entity: { id: "fresh_one", name: "x", surprise: 1 } }, /isn't a field/);
    bad({ type: "addEntity", kind: "signal", entity: { id: "fresh_one", name: "x", points_to: [{ id: "nope", strength: "strong" }] } }, /no circumstance/);
  });

  it("applies a batch all or nothing", () => {
    const base = fresh();
    const ops: FlowOp[] = [
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { name: "Changed" } },
      { type: "updateEntity", kind: "signal", id: "ask_lost_job", patch: { source: "rumour" } },
    ];
    expect(() => applyOp(base, { type: "batch", ops })).toThrow(FlowError);
    expect(sig(base, "ask_lost_job").name).toBe("Says: lost job"); // the input document is never changed
  });
});

describe("settings", () => {
  it("edits the title, scoring text and guardrails", () => {
    const doc = applyOp(fresh(), { type: "updateMeta", patch: { title: "New title", scoring: { flag_when: "at least 3 signals" }, guardrails: ["One", " Two "] } });
    expect(doc.meta.title).toBe("New title");
    expect(doc.meta.scoring.flag_when).toBe("at least 3 signals");
    expect(doc.meta.scoring.strong).toBe(original.meta.scoring.strong);
    expect(doc.meta.guardrails).toEqual(["One", "Two"]);
    expect(() => applyOp(fresh(), { type: "updateMeta", patch: { utilities: ["gas"] } as never })).toThrow(/can't be edited/);
    expect(() => applyOp(fresh(), { type: "updateMeta", patch: { last_verified: "soon" } })).toThrow(/date/);
  });

  it("manages categories and circumstance types, but not while in use", () => {
    let doc = applyOp(fresh(), { type: "upsertCategory", category: { id: "new_cat", name: "New category" } });
    expect(doc.categories.at(-1)).toEqual({ id: "new_cat", name: "New category" });
    doc = applyOp(doc, { type: "upsertCategory", category: { id: "new_cat", name: "Renamed" } });
    expect(doc.categories.filter((c) => c.id === "new_cat")).toHaveLength(1);
    doc = applyOp(doc, { type: "deleteCategory", id: "new_cat" });
    expect(doc.categories.some((c) => c.id === "new_cat")).toBe(false);
    expect(() => applyOp(fresh(), { type: "deleteCategory", id: "income" })).toThrow(/8 circumstances use this category/);
    expect(() => applyOp(fresh(), { type: "deleteCircumstanceType", id: "life" })).toThrow(/54 circumstances use this type/);
    const typed = applyOp(fresh(), { type: "upsertCircumstanceType", item: { id: "new_type", name: "New", meaning: "m", who_acts: "w" } });
    expect(typed.circumstance_types.at(-1)?.id).toBe("new_type");
  });
});

describe("undo", () => {
  it("restores each kind of edit exactly", () => {
    const ops: FlowOp[] = [
      { type: "updateEntity", kind: "solution", id: "payment_extension", patch: { name: "Renamed", verified: false, last_verified: null } },
      { type: "updateEntity", kind: "circumstance", id: "job_loss", patch: { handling: "Careful", sensitivity: "safety" } },
      { type: "setLink", signalId: "ask_lost_job", circumstanceId: "job_loss", strength: "supporting" },
      { type: "removeSignalLink", signalId: "ask_lost_job", circumstanceId: "job_loss" },
      { type: "addSolutionLink", circumstanceId: "job_loss", solutionId: "fdv_helplines" },
      { type: "removeSolutionLink", circumstanceId: "job_loss", solutionId: "payment_extension" },
      { type: "deleteEntity", kind: "signal", id: "acct_missed_payment" },
      { type: "deleteEntity", kind: "circumstance", id: "job_loss" },
      { type: "deleteEntity", kind: "solution", id: "payment_extension" },
      { type: "addEntity", kind: "signal", entity: { id: "brand_new", name: "Brand new", points_to: [{ id: "job_loss", strength: "strong" }] } },
      { type: "updateMeta", patch: { title: "T", scoring: { strong: "S" }, guardrails: ["only"] } },
      { type: "upsertCategory", category: { id: "income", name: "Renamed" } },
      { type: "deleteCategory", id: "nothing_uses_this" },
    ];
    const base = applyOp(fresh(), { type: "upsertCategory", category: { id: "nothing_uses_this", name: "Unused" } });
    for (const op of ops) {
      const { doc, inverse } = applyWithInverse(base, op);
      const undone = applyOp(doc, inverse);
      expect(canon(undone), op.type).toEqual(canon(base));
    }
  });

  it("restores the exact position of a deleted item", () => {
    const index = original.signals.findIndex((s) => s.id === "acct_dishonour");
    const { doc, inverse } = applyWithInverse(fresh(), { type: "deleteEntity", kind: "signal", id: "acct_dishonour" });
    expect(applyOp(doc, inverse).signals.findIndex((s) => s.id === "acct_dishonour")).toBe(index);
  });

  it("undoes a long random run of edits back to the original", () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const pick = <T,>(list: T[]) => list[rnd(list.length)]!;
    let doc = fresh();
    const undo: FlowOp[] = [];
    let applied = 0;
    for (let i = 0; i < 400; i++) {
      const s = pick(doc.signals).id, c = pick(doc.circumstances).id, so = pick(doc.solutions).id;
      const choices: FlowOp[] = [
        { type: "setLink", signalId: s, circumstanceId: c, strength: rnd(2) ? "strong" : "supporting" },
        { type: "removeSignalLink", signalId: pick(doc.signals).id, circumstanceId: c },
        { type: "addSolutionLink", circumstanceId: c, solutionId: so },
        { type: "removeSolutionLink", circumstanceId: c, solutionId: so },
        { type: "updateEntity", kind: "signal", id: s, patch: { name: `Signal ${i}`, sensitive: !!rnd(2) } },
        { type: "updateEntity", kind: "circumstance", id: c, patch: { handling: rnd(2) ? `Note ${i}` : null } },
        { type: "updateEntity", kind: "solution", id: so, patch: { key_facts: `Facts ${i}` } },
        { type: "deleteEntity", kind: "signal", id: s },
        { type: "deleteEntity", kind: "circumstance", id: c },
        { type: "deleteEntity", kind: "solution", id: so },
        { type: "addEntity", kind: "signal", entity: { id: slugId(`sig ${i}`, new Set(doc.signals.map((x) => x.id))), name: `Sig ${i}`, points_to: [{ id: c, strength: "strong" }] } },
        { type: "addEntity", kind: "solution", entity: { id: slugId(`sol ${i}`, new Set(doc.solutions.map((x) => x.id))), name: `Sol ${i}`, used_for: [c] } },
      ];
      // Keep the lists from running dry: only delete while plenty remain.
      const allowed = choices.filter((o) => o.type !== "deleteEntity" || listLength(doc, o.kind) > 20);
      try {
        const r = applyWithInverse(doc, pick(allowed));
        doc = r.doc;
        undo.push(r.inverse);
        applied++;
      } catch (e) { if (!(e instanceof FlowError)) throw e; }
      expect(validateDoc(doc)).toEqual([]);
    }
    expect(applied).toBeGreaterThan(300);
    for (const inverse of undo.reverse()) doc = applyOp(doc, inverse);
    expect(canon(doc)).toEqual(canon(original));
  });
});

describe("helpers", () => {
  it("makes readable unique ids", () => {
    expect(slugId("Bill overdue!", new Set())).toBe("bill_overdue");
    expect(slugId("Bill overdue", new Set(["bill_overdue", "bill_overdue_2"]))).toBe("bill_overdue_3");
    expect(slugId("???", new Set())).toMatch(/^item/);
    expect(slugId("x".repeat(200), new Set()).length).toBeLessThanOrEqual(64);
  });

  it("parses edits received over the network", () => {
    expect(parseOp({ type: "setLink", signalId: "a", circumstanceId: "b", strength: "strong" })).toEqual({ type: "setLink", signalId: "a", circumstanceId: "b", strength: "strong" });
    for (const bad of [null, "x", {}, { type: "explode" }, { type: "setLink", signalId: 1 }, { type: "setLink", signalId: "a", circumstanceId: "b", strength: "huge" }, { type: "addEntity", kind: "thing", entity: {} }, { type: "updateEntity", kind: "signal", id: "a" }, { type: "batch", ops: [{ type: "batch", ops: [] }] }]) {
      expect(() => parseOp(bad)).toThrow(FlowError);
    }
  });

  it("finds problems in a damaged file", () => {
    const broken = fresh();
    circ(broken, "job_loss").signals.push({ id: "does_not_exist", strength: "strong" });
    circ(broken, "job_loss").category = "nope";
    broken.solutions.push({ ...(sol(broken, "fdv_helplines") as FlowSolution) });
    const problems = validateDoc(broken);
    expect(problems.join("\n")).toMatch(/used more than once/);
    expect(validateDoc({})).not.toEqual([]);
    expect(validateDoc(null)).toEqual(["The file is not a JSON object."]);
    const dangling = fresh();
    circ(dangling, "job_loss").signals.push({ id: "does_not_exist", strength: "strong" });
    expect(validateDoc(dangling).join("\n")).toMatch(/which is not a signal/);
    const skewed = fresh();
    (sig(skewed, "ask_lost_job") as FlowSignal).points_to = []; // derived list out of date: not a problem, normalising fixes it
    expect(validateDoc(skewed)).toEqual([]);
    expect(normalizeDoc(skewed).signals.find((s) => s.id === "ask_lost_job")!.points_to).toHaveLength(1);
    expect((circ(fresh(), "job_loss") as FlowCircumstance).signals.length).toBeGreaterThan(0);
  });
});
