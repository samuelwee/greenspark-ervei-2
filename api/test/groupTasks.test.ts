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
  const person = h!.store.dataset().people.find((p) => h!.store.getCaseForPerson(p.id)?.workflow.status !== "resolved")!;
  const signals = [...sensitivityOf(person), ...(person.signalSummary?.account ?? []), ...(person.signalSummary?.selfReport ?? [])];
  const groupId = primarySupportGroup(signals);
  return { groupId, solutionId: NEED_SOLUTIONS[groupId][0]!, eventDate: "2026-10-12", dueDate: "2026-10-18", scope: "Test area",
    personIds: [person.id], assigneeUserId: h!.store.catalog.users.find((u) => u.role === "support_worker")!.id };
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
    expect((await h.call("staff-manager", "POST", "/api/group-tasks", { ...input, groupId: input.groupId === "health" ? "monitor" : "health" })).status).toBe(422);
  });
});
