import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { NEED_SOLUTIONS, SOLUTIONS, SUPPORT_GROUPS, SUPPORT_GROUP_COLORS, type GroupTask, type GroupTaskDetail, type GroupTaskPreview, type GroupTaskSelection, type SolutionId, type SupportGroupId } from "@greenspark/shared";
import type { ApiClient, GroupTaskList, OutlookCustomer } from "../data/api";
import { groupOf } from "../domain/supportGroups";
import { solutionsFor } from "../domain/supportSolutions";
import { accountHref } from "../route";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The task could not be saved. Try again.";
const styleFor = (id: SupportGroupId) => ({ "--group-strong": SUPPORT_GROUP_COLORS[id].strong, "--group-light": SUPPORT_GROUP_COLORS[id].light, "--group-ink": SUPPORT_GROUP_COLORS[id].ink }) as CSSProperties;
export type ActionsClient = Pick<ApiClient, "groupTasks" | "previewGroupTask" | "createGroupTask" | "groupTask" | "updateGroupTask" | "cancelGroupTask">;

function CreateTask({ client, definition, customers, eventDate, scope, defaultDue, catalog, onCreated }: {
  client: ActionsClient; definition: typeof SUPPORT_GROUPS[number]; customers: OutlookCustomer[]; eventDate: string;
  scope: string; defaultDue: string; catalog: GroupTaskList; onCreated: (task: GroupTask) => void;
}) {
  const [solutionId, setSolutionId] = useState<SolutionId>(NEED_SOLUTIONS[definition.id][0]!);
  const [assigneeUserId, setAssignee] = useState(() => catalog.canAssignOthers ? "" : catalog.actorId);
  const [dueDate, setDueDate] = useState(defaultDue);
  const [preview, setPreview] = useState<GroupTaskPreview | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const eligible = useMemo(() => customers.filter((c) => solutionsFor(c).includes(solutionId)), [customers, solutionId]);
  const choices = useMemo(() => [...new Set([...NEED_SOLUTIONS[definition.id], ...customers.flatMap(solutionsFor)])], [definition.id, customers]);
  const selection: GroupTaskSelection = useMemo(() => ({ groupId: definition.id, solutionId, eventDate, scope, personIds: eligible.map((c) => c.personId) }), [definition.id, solutionId, eventDate, scope, eligible]);
  const key = JSON.stringify(selection);
  useEffect(() => {
    let current = true; setPreview(null); setError(null);
    if (!eligible.length) { setPreview({ selected: 0, eligible: 0, duplicate: 0, unavailable: 0 }); return; }
    void client.previewGroupTask!(selection).then((result) => { if (current) setPreview(result); }, (error: unknown) => { if (current) setError(errorMessage(error)); });
    return () => { current = false; };
  }, [client, key, retry]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !preview?.eligible) return;
    setBusy(true); setError(null);
    try {
      const result = await client.createGroupTask!({ ...selection, assigneeUserId, dueDate });
      setRetry((r) => r + 1); onCreated(result.task);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <form className="group-task-form" onSubmit={create}>
    <label>Support task<select value={solutionId} onChange={(e) => setSolutionId(e.target.value as SolutionId)} disabled={busy}>{choices.map((id) => <option key={id} value={id}>{SOLUTIONS[id].title}</option>)}</select></label>
    <details className="task-instructions"><summary>Review task steps</summary><p>{SOLUTIONS[solutionId].steps}</p>
    <p className="task-confirm"><strong>Confirm with each customer:</strong> {SOLUTIONS[solutionId].confirm}</p></details>
    <label>Assign to<select required value={assigneeUserId} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
      <option value="">Choose a support worker</option>{catalog.users.filter((u) => catalog.canAssignOthers || u.id === catalog.actorId).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
    </select></label>
    <label>Due date<input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} /></label>
    <div className="task-selection-info" aria-live="polite">{preview ? <>
      <strong>{preview.eligible.toLocaleString("en-AU")} new customers</strong>
      {preview.duplicate ? <span>{preview.duplicate} already assigned or completed for this solution this forecast week · excluded</span> : null}
      {preview.unavailable ? <span>{preview.unavailable} no longer eligible · excluded</span> : null}
      {!preview.selected ? <span>No customers need this task in the current selection.</span> : null}
    </> : <span>Checking existing assignments…</span>}</div>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="link-btn" onClick={() => setRetry((r) => r + 1)}>Check again</button></div> : null}
    <button className="task-create" type="submit" disabled={busy || !preview?.eligible || !assigneeUserId || !dueDate}>{busy ? "Creating task…" : `Create group task · ${preview?.eligible.toLocaleString("en-AU") ?? "…"}`}</button>
  </form>;
}

function TaskDetail({ client, id, catalog, onBack, onChanged }: { client: ActionsClient; id: string; catalog: GroupTaskList; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<GroupTaskDetail | null>(null), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    let current = true; setBusy(true); setError(null);
    void client.groupTask!(id, page).then((d) => { if (current) setDetail(d); }, (e: unknown) => { if (current) setError(errorMessage(e)); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [client, id, page, retry]);
  const task = detail?.task;
  const editable = !!task && !task.cancelled && (catalog.canAssignOthers || catalog.actorId === task.assigneeUserId);
  async function update(personIds: string[], completed: boolean) {
    if (!task || busy) return; setBusy(true); setError(null);
    try { await client.updateGroupTask!(id, { expectedVersion: task.version, personIds, completed }); setRetry((r) => r + 1); onChanged(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!task || busy) return; setBusy(true); setError(null);
    try { await client.cancelGroupTask!(id, task.version); onChanged(); setRetry((r) => r + 1); setConfirmCancel(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="task-detail">
    <button type="button" className="link-btn" onClick={onBack}>← Back to actions</button>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="btn btn-small" disabled={busy} onClick={() => setRetry((r) => r + 1)}>Reload task</button></div> : null}
    {task && detail ? <section className="support-solution-card task-detail-card" style={styleFor(task.groupId)}>
      <h3>{SOLUTIONS[task.solutionId].title}</h3><p>{task.scope}</p>
      <p>Assigned to {catalog.users.find((u) => u.id === task.assigneeUserId)?.displayName ?? task.assigneeUserId} · Due {task.dueDate}</p>
      <strong className="task-progress-label">{task.cancelled ? "Cancelled" : `${task.completed} of ${task.total} completed`}</strong>
      <progress aria-label="Task completion" value={task.completed} max={task.total} />
      <p>{SOLUTIONS[task.solutionId].steps}</p>
      <p className="task-confirm">{SOLUTIONS[task.solutionId].confirm}</p>
      {!editable && !task.cancelled ? <p className="sub">Progress can be updated by the assigned worker or a manager.</p> : null}
      <ul className="task-member-list">{detail.members.map((m) => <li key={m.personId}>
        <label><input type="checkbox" checked={m.completed} disabled={!editable || busy} onChange={() => void update([m.personId], !m.completed)} /><span>{m.displayName}<small>{m.completed ? "Completed" : "To do"}</small></span></label>
        {m.accountNumber ? <a href={accountHref(m.accountNumber)} aria-label={`Open case for ${m.displayName}`}>Case ↗</a> : null}
      </li>)}</ul>
      {editable && detail.members.some((m) => !m.completed) ? <button type="button" className="btn btn-small" disabled={busy} onClick={() => void update(detail.members.filter((m) => !m.completed).map((m) => m.personId), true)}>Mark this page complete ({detail.members.filter((m) => !m.completed).length})</button> : null}
      <div className="task-pager"><button type="button" className="btn btn-small" disabled={busy || page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {detail.page} / {detail.pageCount}</span><button type="button" className="btn btn-small" disabled={busy || page >= detail.pageCount} onClick={() => setPage((p) => p + 1)}>Next</button></div>
      {editable ? confirmCancel ? <div className="task-cancel-confirm"><p>Cancel this task and release its customer assignments?</p><button type="button" className="btn btn-small" disabled={busy} onClick={() => void cancel()}>Confirm cancellation</button><button type="button" className="link-btn" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep task</button></div> : <button type="button" className="link-btn" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel task</button> : null}
    </section> : <p role="status">Loading task…</p>}
  </div>;
}

export function SupportActions({ client, customers, groups, scope, eventDate, defaultDue, focusGroup }: {
  client: ActionsClient; customers: OutlookCustomer[]; groups: SupportGroupId[]; scope: string; eventDate: string; defaultDue: string; focusGroup: SupportGroupId | null;
}) {
  const [catalog, setCatalog] = useState<GroupTaskList | null>(null), [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<SupportGroupId | null>(focusGroup ?? groups.at(-1) ?? null), [taskId, setTaskId] = useState<string | null>(null);
  const supported = !!(client.groupTasks && client.previewGroupTask && client.createGroupTask && client.groupTask && client.updateGroupTask && client.cancelGroupTask);
  useEffect(() => { setExpanded(focusGroup ?? groups.at(-1) ?? null); }, [groups.join("|"), focusGroup]);
  useEffect(() => { setTaskId(null); setNotice(null); }, [scope, eventDate, groups.join("|")]);
  useEffect(() => {
    if (!supported) return;
    let current = true; setError(null);
    void client.groupTasks!(eventDate).then((result) => { if (current) setCatalog(result); }, (e: unknown) => { if (current) setError(errorMessage(e)); });
    return () => { current = false; };
  }, [client, supported, eventDate, retry]);
  if (!supported) return <p className="hint">Group tasks are unavailable on this server.</p>;
  const refresh = () => setRetry((r) => r + 1);
  return <div className="support-actions">
    {error ? <div role="alert"><p>{error}</p><button type="button" className="link-btn" onClick={refresh}>Reload actions</button></div> : null}
    {notice ? <p className="task-notice" role="status">{notice}</p> : null}
    {!catalog ? <p role="status">Loading group tasks…</p> : taskId ? <TaskDetail key={taskId} client={client} id={taskId} catalog={catalog} onBack={() => setTaskId(null)} onChanged={refresh} /> : <>
      <p className="sub">Create and track tasks for the selected customers.</p>
      <div className="support-solution-stack">{groups.map((id) => {
        const definition = SUPPORT_GROUPS.find((g) => g.id === id)!, members = customers.filter((c) => groupOf(c) === id);
        const open = expanded === id;
        return <section key={id} className="support-solution-card action-group-card" style={styleFor(id)} data-group={id}>
          <button type="button" className="solution-card-heading" aria-expanded={open} aria-controls={`actions-${id}`} onClick={() => setExpanded(open ? null : id)}><span className="solution-group-badge">{definition.letter}</span><span><strong>{definition.label}</strong><small>{members.length.toLocaleString("en-AU")} customers selected</small></span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
          <div id={`actions-${id}`} hidden={!open} className="solution-card-body">{open ? <CreateTask key={`${id}:${scope}:${eventDate}:${defaultDue}`} client={client} definition={definition} customers={members} eventDate={eventDate} scope={scope} defaultDue={defaultDue} catalog={catalog} onCreated={(task) => { setNotice(`Task created for ${task.total} customers. No messages have been sent.`); refresh(); }} /> : null}</div>
        </section>;
      })}</div>
      {!groups.length ? <p className="hint">Turn on a group filter to create a task.</p> : null}
      <section className="saved-group-tasks"><h3>Saved tasks · forecast week</h3><p className="sub">Across all areas for the selected groups</p>
        {catalog.tasks.filter((task) => groups.includes(task.groupId)).map((task) => <article key={task.id} className="saved-group-task" style={styleFor(task.groupId)}>
          <strong>{SOLUTIONS[task.solutionId].title}</strong><span>{task.scope}</span><small>Due {task.dueDate} · {catalog.users.find((u) => u.id === task.assigneeUserId)?.displayName}</small>
          <span>{task.cancelled ? "Cancelled" : task.completed === task.total ? "Completed" : task.completed ? "In progress" : "To do"} · {task.completed} / {task.total}</span><progress aria-label={`${SOLUTIONS[task.solutionId].title} completion`} value={task.completed} max={task.total} />
          <button type="button" className="btn btn-small" onClick={() => setTaskId(task.id)}>View task</button>
        </article>)}
        {!catalog.tasks.some((task) => groups.includes(task.groupId)) ? <p className="sub">No tasks created for these groups this forecast week.</p> : null}
      </section>
    </>}
    <p className="support-caution">Creating a task organises work in this app. It does not contact customers or change their account.</p>
  </div>;
}
