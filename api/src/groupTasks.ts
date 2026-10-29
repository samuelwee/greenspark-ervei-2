import { randomUUID } from "node:crypto";
import { NEED_SOLUTIONS, primarySupportGroup, sensitivityOf, supportGroupNeeds, type CreateGroupTask, type GroupTask, type GroupTaskDetail, type GroupTaskPreview, type GroupTaskSelection, type StaffUser, type SupportGroupId } from "@greenspark/shared";
import type { Store } from "./store";
import type { Clock } from "./clock";
import { ApiError } from "./errors";

type Row = Record<string, string | number | null>;
// Member and area counts are counted separately, so each kind reports its own checklist.
const SUMMARY = `SELECT t.*, (SELECT COUNT(*) FROM group_task_members m WHERE m.task_id = t.id) AS member_total,
  COALESCE((SELECT SUM(m.completed) FROM group_task_members m WHERE m.task_id = t.id), 0) AS member_completed,
  (SELECT COUNT(*) FROM group_task_areas a WHERE a.task_id = t.id) AS area_total,
  COALESCE((SELECT SUM(a.completed) FROM group_task_areas a WHERE a.task_id = t.id), 0) AS area_completed
 FROM group_tasks t`;
function taskOf(r: Row): GroupTask {
  const kind = String(r.kind) as GroupTask["kind"], areas = kind === "moratorium";
  return { id: String(r.id), kind,
    groupIds: JSON.parse(String(r.group_ids)) as SupportGroupId[],
    solutionId: r.solution_id == null ? null : String(r.solution_id) as GroupTask["solutionId"],
    eventDate: String(r.event_date), scope: String(r.scope), scopePostcodes: JSON.parse(String(r.scope_postcodes)) as string[],
    assigneeUserId: String(r.assignee_user_id), dueDate: String(r.due_date),
    createdBy: String(r.created_by), createdAt: String(r.created_at), version: Number(r.version), cancelled: !!r.cancelled,
    total: Number(areas ? r.area_total : r.member_total), completed: Number(areas ? r.area_completed : r.member_completed) };
}

/** Persistent task work is separate from the case workflow: completing a check does not resolve a case. */
export class GroupTasks {
  constructor(private store: Store, private clock: Clock) {}
  list(eventDate: string): GroupTask[] {
    return (this.store.db.prepare(`${SUMMARY} WHERE t.event_date = ? GROUP BY t.id ORDER BY t.created_at DESC, t.id`).all(eventDate) as Row[]).map(taskOf);
  }
  /** Customers with work scheduled for this forecast week: members of active solution tasks,
      and customers in postcode areas covered by an active moratorium. */
  coverage(eventDate: string): { coveredPersonIds: string[]; coveredPostcodes: string[] } {
    const members = (this.store.db.prepare(`SELECT m.person_id FROM group_task_members m JOIN group_tasks t ON t.id = m.task_id
      WHERE t.event_date = ? AND t.cancelled = 0`).all(eventDate) as Row[]).map((r) => String(r.person_id));
    const postcodes: string[] = [];
    for (const t of this.list(eventDate)) if (t.kind === "moratorium" && !t.cancelled) postcodes.push(...t.scopePostcodes);
    return { coveredPersonIds: members, coveredPostcodes: postcodes };
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
  private solutionSelection(input: GroupTaskSelection) {
    // Read in batches through JSON, avoiding SQLite's variable limit for large cohorts.
    const rows = this.store.db.prepare(`SELECT p.id, p.doc, c.id AS case_id, c.status FROM people p
      JOIN cases c ON c.id = (SELECT id FROM cases WHERE person_id = p.id ORDER BY seq DESC LIMIT 1)
      WHERE p.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(input.personIds)) as Row[];
    const solutionId = input.solutionId!;
    const duplicates = new Set((this.store.db.prepare(`SELECT m.person_id FROM group_task_members m JOIN group_tasks t ON t.id = m.task_id
      WHERE t.event_date = ? AND t.solution_id = ? AND t.cancelled = 0`).all(input.eventDate, solutionId) as Row[]).map((r) => String(r.person_id)));
    const eligible = rows.filter((r) => {
      if (r.status === "resolved") return false;
      const person = JSON.parse(String(r.doc));
      const signals = [...sensitivityOf(person), ...(person.signalSummary?.account ?? []), ...(person.signalSummary?.selfReport ?? [])];
      if (!input.groupIds.includes(primarySupportGroup(signals))) return false;
      const solutions = supportGroupNeeds(signals).flatMap((need) => NEED_SOLUTIONS[need]);
      if (signals.some((s) => ["acct_interpreter", "acct_digital_disengaged", "ask_no_internet"].includes(s.id))) solutions.push("contact");
      return solutions.includes(solutionId);
    });
    const duplicate = eligible.filter((r) => duplicates.has(String(r.id))).length;
    return { rows: eligible.filter((r) => !duplicates.has(String(r.id))), preview: {
      selected: input.personIds.length, eligible: eligible.length - duplicate, duplicate, unavailable: input.personIds.length - eligible.length,
    } satisfies GroupTaskPreview };
  }
  private moratoriumSelection(input: GroupTaskSelection) {
    const covered = new Set<string>();
    for (const t of this.list(input.eventDate)) if (t.kind === "moratorium" && !t.cancelled) for (const pc of t.scopePostcodes) covered.add(pc);
    const fresh = input.scopePostcodes.filter((pc) => !covered.has(pc));
    return { rows: fresh, preview: {
      selected: input.scopePostcodes.length, eligible: fresh.length, duplicate: input.scopePostcodes.length - fresh.length, unavailable: 0,
    } satisfies GroupTaskPreview };
  }
  private selection(input: GroupTaskSelection) { return input.kind === "moratorium" ? this.moratoriumSelection(input) : this.solutionSelection(input); }
  preview(input: GroupTaskSelection) { return this.selection(input).preview; }
  create(actor: StaffUser, input: CreateGroupTask) {
    if (actor.role !== "manager" && input.assigneeUserId !== actor.id) throw new ApiError("forbidden", "You can assign a group task to yourself; a manager can assign another worker.");
    if (!this.store.catalog.users.some((u) => u.id === input.assigneeUserId && u.role === "support_worker")) throw new ApiError("validation_failed", "Choose a support worker.");
    return this.store.transaction(() => {
      const { rows, preview } = this.selection(input);
      if (!rows.length) throw new ApiError("validation_failed", input.kind === "moratorium"
        ? "No new postcode areas remain. An existing moratorium already covers this selection."
        : "No new eligible customers remain. Existing tasks or changed records may already cover this selection.");
      const id = randomUUID();
      const scopePostcodes = input.kind === "moratorium" ? rows.map((r) => r as string) : [];
      this.store.db.prepare(`INSERT INTO group_tasks (id, kind, group_ids, solution_id, event_date, scope, scope_postcodes, assignee_user_id, due_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.kind, JSON.stringify(input.groupIds), input.solutionId ?? null, input.eventDate, input.scope, JSON.stringify(scopePostcodes), input.assigneeUserId, input.dueDate, actor.id, this.clock().toISOString());
      if (input.kind === "solution") {
        const add = this.store.db.prepare("INSERT INTO group_task_members (task_id, person_id, case_id) VALUES (?, ?, ?)");
        for (const r of rows as Row[]) add.run(id, r.id!, r.case_id!);
      } else {
        const add = this.store.db.prepare("INSERT INTO group_task_areas (task_id, postcode) VALUES (?, ?)");
        for (const pc of scopePostcodes) add.run(id, pc);
      }
      return { task: this.get(id), preview };
    });
  }
  detail(id: string, page = 1): GroupTaskDetail {
    const task = this.get(id), pageCount = Math.max(1, Math.ceil(task.total / 50));
    page = Math.min(page, pageCount);
    if (task.kind === "moratorium") {
      const rows = this.store.db.prepare(`SELECT postcode, completed FROM group_task_areas
        WHERE task_id = ? ORDER BY completed, postcode LIMIT 50 OFFSET ?`).all(id, (page - 1) * 50) as Row[];
      // The suburb shown next to each postcode, from the people that live there.
      const postcodes = rows.map((r) => String(r.postcode));
      const suburbRows = postcodes.length
        ? this.store.db.prepare(`SELECT json_extract(doc, '$.address.postcode') AS pc, json_extract(doc, '$.suburb') AS suburb
          FROM people WHERE json_extract(doc, '$.address.postcode') IN (SELECT value FROM json_each(?))`).all(JSON.stringify(postcodes)) as Row[]
        : [];
      const suburbOf = new Map<string, string>();
      for (const r of suburbRows) if (r.pc && r.suburb && !suburbOf.has(String(r.pc))) suburbOf.set(String(r.pc), String(r.suburb));
      return { task, page, pageCount, members: [], areas: rows.map((r) => ({
        postcode: String(r.postcode), suburb: suburbOf.get(String(r.postcode)) ?? null, completed: !!r.completed,
      })) };
    }
    const rows = this.store.db.prepare(`SELECT m.*, p.doc FROM group_task_members m JOIN people p ON p.id = m.person_id
      WHERE m.task_id = ? ORDER BY m.completed, m.person_id LIMIT 50 OFFSET ?`).all(id, (page - 1) * 50) as Row[];
    return { task, page, pageCount, members: rows.map((r) => {
      const p = JSON.parse(String(r.doc));
      return { personId: String(r.person_id), caseId: String(r.case_id), displayName: p.displayName, accountNumber: p.accountNumber ?? null, completed: !!r.completed };
    }), areas: [] };
  }
  update(actor: StaffUser, id: string, input: { expectedVersion: number; personIds: string[]; completed: boolean }) {
    return this.store.transaction(() => {
      const task = this.get(id); this.editable(actor, task);
      if (task.kind === "moratorium") throw new ApiError("validation_failed", "A moratorium has no member list to update; use its postcode checklist instead.");
      if (task.version !== input.expectedVersion) throw new ApiError("version_conflict", "This task changed. Reload it before updating progress.");
      const matched = this.store.db.prepare("SELECT COUNT(*) AS n FROM group_task_members WHERE task_id = ? AND person_id IN (SELECT value FROM json_each(?))").get(id, JSON.stringify(input.personIds)) as Row;
      if (Number(matched.n) !== input.personIds.length) throw new ApiError("validation_failed", "A customer is not part of this task.");
      this.store.db.prepare(`UPDATE group_task_members SET completed = ?, updated_by = ?, updated_at = ?
        WHERE task_id = ? AND person_id IN (SELECT value FROM json_each(?))`).run(Number(input.completed), actor.id, this.clock().toISOString(), id, JSON.stringify(input.personIds));
      this.store.db.prepare("UPDATE group_tasks SET version = version + 1 WHERE id = ?").run(id);
      return this.get(id);
    });
  }
  /** Moratorium progress: toggle the task's postcode areas with the same guards as members. */
  updateAreas(actor: StaffUser, id: string, input: { expectedVersion: number; postcodes: string[]; completed: boolean }) {
    return this.store.transaction(() => {
      const task = this.get(id); this.editable(actor, task);
      if (task.kind !== "moratorium") throw new ApiError("validation_failed", "Only a moratorium has a postcode checklist.");
      if (task.version !== input.expectedVersion) throw new ApiError("version_conflict", "This task changed. Reload it before updating progress.");
      const matched = this.store.db.prepare("SELECT COUNT(*) AS n FROM group_task_areas WHERE task_id = ? AND postcode IN (SELECT value FROM json_each(?))").get(id, JSON.stringify(input.postcodes)) as Row;
      if (Number(matched.n) !== input.postcodes.length) throw new ApiError("validation_failed", "A postcode is not part of this task.");
      this.store.db.prepare(`UPDATE group_task_areas SET completed = ?, updated_by = ?, updated_at = ?
        WHERE task_id = ? AND postcode IN (SELECT value FROM json_each(?))`).run(Number(input.completed), actor.id, this.clock().toISOString(), id, JSON.stringify(input.postcodes));
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
