import { randomUUID } from "node:crypto";
import { NEED_SOLUTIONS, primarySupportGroup, sensitivityOf, supportGroupNeeds, type CreateGroupTask, type GroupTask, type GroupTaskDetail, type GroupTaskPreview, type GroupTaskSelection, type StaffUser } from "@greenspark/shared";
import type { Store } from "./store";
import type { Clock } from "./clock";
import { ApiError } from "./errors";

type Row = Record<string, string | number | null>;
const SUMMARY = `SELECT t.*, COUNT(m.person_id) AS total, COALESCE(SUM(m.completed), 0) AS completed
 FROM group_tasks t LEFT JOIN group_task_members m ON m.task_id = t.id`;
function taskOf(r: Row): GroupTask {
  return { id: String(r.id), groupId: r.group_id as GroupTask["groupId"], solutionId: r.solution_id as GroupTask["solutionId"],
    eventDate: String(r.event_date), scope: String(r.scope), assigneeUserId: String(r.assignee_user_id), dueDate: String(r.due_date),
    createdBy: String(r.created_by), createdAt: String(r.created_at), version: Number(r.version), cancelled: !!r.cancelled,
    total: Number(r.total), completed: Number(r.completed) };
}

/** Persistent task work is separate from the case workflow: completing a check does not resolve a case. */
export class GroupTasks {
  constructor(private store: Store, private clock: Clock) {}
  list(eventDate: string): GroupTask[] {
    return (this.store.db.prepare(`${SUMMARY} WHERE t.event_date = ? GROUP BY t.id ORDER BY t.created_at DESC, t.id`).all(eventDate) as Row[]).map(taskOf);
  }
  private get(id: string): GroupTask {
    const row = this.store.db.prepare(`${SUMMARY} WHERE t.id = ? GROUP BY t.id`).get(id) as Row | undefined;
    if (!row) throw new ApiError("not_found", "This group task could not be found.");
    return taskOf(row);
  }
  private editable(actor: StaffUser, task: GroupTask) {
    if (actor.role !== "manager" && task.assigneeUserId !== actor.id) throw new ApiError("forbidden", "Only the assigned worker or a manager can update this task.");
    if (task.cancelled) throw new ApiError("validation_failed", "This task has been cancelled.");
  }
  private selection(input: GroupTaskSelection) {
    // Read in batches through JSON, avoiding SQLite's variable limit for large cohorts.
    const rows = this.store.db.prepare(`SELECT p.id, p.doc, c.id AS case_id, c.status FROM people p
      JOIN cases c ON c.id = (SELECT id FROM cases WHERE person_id = p.id ORDER BY seq DESC LIMIT 1)
      WHERE p.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(input.personIds)) as Row[];
    const duplicates = new Set((this.store.db.prepare(`SELECT m.person_id FROM group_task_members m JOIN group_tasks t ON t.id = m.task_id
      WHERE t.event_date = ? AND t.solution_id = ? AND t.cancelled = 0`).all(input.eventDate, input.solutionId) as Row[]).map((r) => String(r.person_id)));
    const eligible = rows.filter((r) => {
      if (r.status === "resolved") return false;
      const person = JSON.parse(String(r.doc));
      const signals = [...sensitivityOf(person), ...(person.signalSummary?.account ?? []), ...(person.signalSummary?.selfReport ?? [])];
      if (primarySupportGroup(signals) !== input.groupId) return false;
      const solutions = supportGroupNeeds(signals).flatMap((need) => NEED_SOLUTIONS[need]);
      if (signals.some((s) => ["acct_interpreter", "acct_digital_disengaged", "ask_no_internet"].includes(s.id))) solutions.push("contact");
      return solutions.includes(input.solutionId);
    });
    const duplicate = eligible.filter((r) => duplicates.has(String(r.id))).length;
    return { rows: eligible.filter((r) => !duplicates.has(String(r.id))), preview: {
      selected: input.personIds.length, eligible: eligible.length - duplicate, duplicate, unavailable: input.personIds.length - eligible.length,
    } satisfies GroupTaskPreview };
  }
  preview(input: GroupTaskSelection) { return this.selection(input).preview; }
  create(actor: StaffUser, input: CreateGroupTask) {
    if (actor.role !== "manager" && input.assigneeUserId !== actor.id) throw new ApiError("forbidden", "You can assign a group task to yourself; a manager can assign another worker.");
    if (!this.store.catalog.users.some((u) => u.id === input.assigneeUserId && u.role === "support_worker")) throw new ApiError("validation_failed", "Choose a support worker.");
    return this.store.transaction(() => {
      const { rows, preview } = this.selection(input);
      if (!rows.length) throw new ApiError("validation_failed", "No new eligible customers remain. Existing tasks or changed records may already cover this selection.");
      const id = randomUUID();
      this.store.db.prepare(`INSERT INTO group_tasks (id, group_id, solution_id, event_date, scope, assignee_user_id, due_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.groupId, input.solutionId, input.eventDate, input.scope, input.assigneeUserId, input.dueDate, actor.id, this.clock().toISOString());
      const add = this.store.db.prepare("INSERT INTO group_task_members (task_id, person_id, case_id) VALUES (?, ?, ?)");
      for (const r of rows) add.run(id, r.id!, r.case_id!);
      return { task: this.get(id), preview };
    });
  }
  detail(id: string, page = 1): GroupTaskDetail {
    const task = this.get(id), pageCount = Math.max(1, Math.ceil(task.total / 50));
    page = Math.min(page, pageCount);
    const rows = this.store.db.prepare(`SELECT m.*, p.doc FROM group_task_members m JOIN people p ON p.id = m.person_id
      WHERE m.task_id = ? ORDER BY m.completed, m.person_id LIMIT 50 OFFSET ?`).all(id, (page - 1) * 50) as Row[];
    return { task, page, pageCount, members: rows.map((r) => {
      const p = JSON.parse(String(r.doc));
      return { personId: String(r.person_id), caseId: String(r.case_id), displayName: p.displayName, accountNumber: p.accountNumber ?? null, completed: !!r.completed };
    }) };
  }
  update(actor: StaffUser, id: string, input: { expectedVersion: number; personIds: string[]; completed: boolean }) {
    return this.store.transaction(() => {
      const task = this.get(id); this.editable(actor, task);
      if (task.version !== input.expectedVersion) throw new ApiError("version_conflict", "This task changed. Reload it before updating progress.");
      const matched = this.store.db.prepare("SELECT COUNT(*) AS n FROM group_task_members WHERE task_id = ? AND person_id IN (SELECT value FROM json_each(?))").get(id, JSON.stringify(input.personIds)) as Row;
      if (Number(matched.n) !== input.personIds.length) throw new ApiError("validation_failed", "A customer is not part of this task.");
      this.store.db.prepare(`UPDATE group_task_members SET completed = ?, updated_by = ?, updated_at = ?
        WHERE task_id = ? AND person_id IN (SELECT value FROM json_each(?))`).run(Number(input.completed), actor.id, this.clock().toISOString(), id, JSON.stringify(input.personIds));
      this.store.db.prepare("UPDATE group_tasks SET version = version + 1 WHERE id = ?").run(id);
      return this.get(id);
    });
  }
  cancel(actor: StaffUser, id: string, expectedVersion: number) {
    return this.store.transaction(() => {
      const task = this.get(id); this.editable(actor, task);
      if (task.version !== expectedVersion) throw new ApiError("version_conflict", "This task changed. Reload it before cancelling.");
      this.store.db.prepare("UPDATE group_tasks SET cancelled = 1, version = version + 1 WHERE id = ?").run(id);
      return this.get(id);
    });
  }
}
