import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NEED_SOLUTIONS, primarySupportGroup, sensitivityOf, type CreateGroupTask } from "@greenspark/shared";
import { start, type Harness } from "./helpers";

let h: Harness | null = null;
let directory: string | null = null;
afterEach(async () => { await h?.stop(); h = null; if (directory) rmSync(directory, { recursive: true, force: true }); directory = null; });
function selection(): CreateGroupTask {
  // A customer with a recorded risk signal (some fixture people have none).
  const person = h!.store.dataset().people.find((p) => {
    if (h!.store.getCaseForPerson(p.id)?.workflow.status === "resolved") return false;
    const signals = [...sensitivityOf(p), ...(p.signalSummary?.account ?? []), ...(p.signalSummary?.selfReport ?? [])];
    return primarySupportGroup(signals) !== null;
  })!;
  const signals = [...sensitivityOf(person), ...(person.signalSummary?.account ?? []), ...(person.signalSummary?.selfReport ?? [])];
  const groupId = primarySupportGroup(signals)!;
  return { kind: "solution", groupIds: [groupId], solutionId: NEED_SOLUTIONS[groupId][0]!, eventDate: "2026-10-12", dueDate: "2026-10-18", scope: "Test area", scopePostcodes: [],
    personIds: [person.id], assigneeUserId: h!.store.catalog.users.find((u) => u.role === "support_worker")!.id };
}
function postcodes(): [string, string] {
  const values = h!.store.dataset().people.map((p) => p.address?.postcode).filter((pc): pc is string => typeof pc === "string" && pc.length > 0);
  const first = values[0]!;
  return [first, values.find((pc) => pc !== first)!];
}
function moratorium(postcode: string[]): CreateGroupTask {
  return { kind: "moratorium", groupIds: [], solutionId: null, eventDate: "2026-10-12", dueDate: "2026-10-18", scope: "Area directive", scopePostcodes: postcode, personIds: [],
    assigneeUserId: h!.store.catalog.users.find((u) => u.role === "support_worker")!.id };
}

describe("group tasks", () => {
  it("persists tasks and progress, deduplicates overlapping areas, and permits work in a later week", async () => {
    directory = mkdtempSync(join(tmpdir(), "ervei-tasks-"));
    const database = join(directory, "tasks.sqlite");
    h = await start(database); const input = selection();
    const results = await Promise.all([h.call("staff-manager", "POST", "/api/group-tasks", input), h.call("staff-manager", "POST", "/api/group-tasks", { ...input, scope: "Overlapping area" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const task = results.find((r) => r.status === 201)!.body.task;
    const preview = await h.call("staff-manager", "POST", "/api/group-tasks/preview", { ...input, dueDate: undefined, assigneeUserId: undefined });
    expect(preview.body).toEqual({ selected: 1, eligible: 0, duplicate: 1, unavailable: 0 });
    const update = await h.call(input.assigneeUserId, "PATCH", `/api/group-tasks/${task.id}/progress`, { expectedVersion: task.version, personIds: input.personIds, completed: true });
    expect(update.status).toBe(200); expect(update.body.task.completed).toBe(1);
    await h.stop(); h = await start(database);
    const detail = await h.call("staff-manager", "GET", `/api/group-tasks/${task.id}`);
    expect(detail.body.task.completed).toBe(1); expect(detail.body.members[0].completed).toBe(true);
    expect(detail.body.areas).toEqual([]);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", input)).status).toBe(422);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, eventDate: "2026-10-19" })).status).toBe(201);
  });
  it("checks ownership, membership and task versions, and releases cancelled assignments", async () => {
    h = await start(); const input = selection();
    const other = h.store.catalog.users.find((u) => u.role === "support_worker" && u.id !== input.assigneeUserId)!;
    expect((await h.call(other.id, "POST", "/api/group-tasks", input)).status).toBe(403);
    const task = (await h.call("staff-manager", "POST", "/api/group-tasks", input)).body.task;
    const url = `/api/group-tasks/${task.id}/progress`, update = { expectedVersion: task.version, personIds: input.personIds, completed: true };
    expect((await h.call(other.id, "PATCH", url, update)).status).toBe(403);
    expect((await h.call("staff-manager", "PATCH", url, { ...update, personIds: ["missing"] })).status).toBe(422);
    expect((await h.call(input.assigneeUserId, "PATCH", url, update)).status).toBe(200);
    expect((await h.call("staff-manager", "PATCH", url, update)).status).toBe(409);
    expect((await h.call("staff-manager", "POST", `/api/group-tasks/${task.id}/cancel`, { expectedVersion: 2 })).status).toBe(200);
    expect((await h.call("staff-manager", "PATCH", url, { ...update, expectedVersion: 3 })).status).toBe(422);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", input)).status).toBe(201);
  });
  it("rejects invalid dates, duplicate IDs and unsupported needs without adding members", async () => {
    h = await start(); const input = selection();
    expect((await h.call(null, "POST", "/api/group-tasks", input)).status).toBe(401);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, dueDate: "2026-02-31" })).status).toBe(422);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, personIds: [...input.personIds, ...input.personIds] })).status).toBe(422);
    const preview = (await h.call("staff-manager", "POST", "/api/group-tasks/preview", { ...input, assigneeUserId: undefined, dueDate: undefined, personIds: ["missing"] })).body;
    expect(preview.unavailable).toBe(1); expect(preview.eligible).toBe(0);
    const large = await h.call("staff-manager", "POST", "/api/group-tasks/preview", { ...input, assigneeUserId: undefined, dueDate: undefined, personIds: Array.from({ length: 10000 }, (_, i) => `missing-customer-${i}`) });
    expect(large.status).toBe(200); expect(large.body.unavailable).toBe(10000);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, groupIds: ["no-such-group"] })).status).toBe(422);
  });
  it("a task can span several selected groups when each customer fits its own group", async () => {
    h = await start(); const input = selection();
    const other = input.groupIds[0]! === "bills" ? "health" : "bills";
    const task = await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, groupIds: [other, input.groupIds[0]!] });
    expect(task.status).toBe(201);
    expect(task.body.task.groupIds).toEqual([other, input.groupIds[0]!]);
  });
  it("issues a moratorium over postcode areas, deduplicates them, tracks the area checklist and reports coverage", async () => {
    h = await start();
    const [first, second] = postcodes();
    const input = moratorium([first]);
    const created = await h.call("staff-manager", "POST", "/api/group-tasks", input);
    expect(created.status).toBe(201);
    expect(created.body.task.kind).toBe("moratorium");
    expect(created.body.task.scopePostcodes).toEqual([first]);
    expect(created.body.task.total).toBe(1);
    expect(created.body.task.completed).toBe(0);
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", moratorium([first]))).status).toBe(422);
    const mixed = await h.call("staff-manager", "POST", "/api/group-tasks", moratorium([first, second]));
    expect(mixed.status).toBe(201);
    expect(mixed.body.task.scopePostcodes).toEqual([second]);
    expect(mixed.body.task.total).toBe(1);
    // The member route cannot update a moratorium; its checklist uses the area route.
    expect((await h.call(mixed.body.task.assigneeUserId, "PATCH", `/api/group-tasks/${mixed.body.task.id}/progress`, { expectedVersion: mixed.body.task.version, personIds: [], completed: true })).status).toBe(422);
    const other = h.store.catalog.users.find((u) => u.role === "support_worker" && u.id !== mixed.body.task.assigneeUserId)!;
    const areaUrl = `/api/group-tasks/${mixed.body.task.id}/area-progress`, areaUpdate = { expectedVersion: mixed.body.task.version, postcodes: [second], completed: true };
    expect((await h.call(other.id, "PATCH", areaUrl, areaUpdate)).status).toBe(403);
    expect((await h.call(mixed.body.task.assigneeUserId, "PATCH", areaUrl, { ...areaUpdate, postcodes: ["not-part"] })).status).toBe(422);
    const update = await h.call(mixed.body.task.assigneeUserId, "PATCH", areaUrl, areaUpdate);
    expect(update.status).toBe(200); expect(update.body.task.completed).toBe(1);
    expect((await h.call("staff-manager", "PATCH", areaUrl, { ...areaUpdate, expectedVersion: update.body.task.version + 1 })).status).toBe(409);
    const detail = await h.call("staff-manager", "GET", `/api/group-tasks/${mixed.body.task.id}`);
    const suburb = h.store.allPeople().find((p) => p.address?.postcode === second)?.suburb ?? null;
    expect(detail.body.areas).toEqual([{ postcode: second, suburb, completed: true }]);
    expect(detail.body.members).toEqual([]);
    expect(detail.body.task.total).toBe(1); expect(detail.body.task.completed).toBe(1);
    // Area rows page 50 at a time, like members.
    const many = Array.from({ length: 60 }, (_, i) => `69${String(i).padStart(2, "0")}`);
    const big = await h.call("staff-manager", "POST", "/api/group-tasks", moratorium(many));
    expect(big.status).toBe(201); expect(big.body.task.total).toBe(60);
    const page1 = await h.call("staff-manager", "GET", `/api/group-tasks/${big.body.task.id}`);
    expect(page1.body.pageCount).toBe(2); expect(page1.body.areas).toHaveLength(50);
    const page2 = await h.call("staff-manager", "GET", `/api/group-tasks/${big.body.task.id}?page=2`);
    expect(page2.body.areas).toHaveLength(10);
    const list = await h.call("staff-manager", "GET", "/api/group-tasks?eventDate=2026-10-12");
    expect(list.body.coveredPostcodes.sort()).toEqual([first, second, ...many].sort());
    const solution = await h.call("staff-manager", "POST", "/api/group-tasks", selection());
    expect(solution.status).toBe(201);
    const after = await h.call("staff-manager", "GET", "/api/group-tasks?eventDate=2026-10-12");
    expect(after.body.coveredPersonIds).toContain(selection().personIds[0]);
    const cancel = await h.call("staff-manager", "POST", `/api/group-tasks/${created.body.task.id}/cancel`, { expectedVersion: created.body.task.version });
    expect(cancel.status).toBe(200);
    const released = await h.call("staff-manager", "GET", "/api/group-tasks?eventDate=2026-10-12");
    expect(released.body.coveredPostcodes.sort()).toEqual([second, ...many].sort());
    expect(released.body.coveredPersonIds).toContain(selection().personIds[0]);
  });
});
