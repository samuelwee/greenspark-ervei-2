import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DIRECTIVES, NEED_SOLUTIONS, SOLUTIONS, SUPPORT_GROUPS, SUPPORT_GROUP_COLORS, type GroupTask, type GroupTaskDetail, type GroupTaskPreview, type GroupTaskSelection, type SolutionId, type SupportGroupId } from "@greenspark/shared";
import type { ApiClient, GroupTaskList, OutlookCustomer } from "../data/api";
import { groupOf } from "../domain/supportGroups";
import { solutionsFor } from "../domain/supportSolutions";
import { accountHref } from "../route";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The task could not be saved. Try again.";
const styleFor = (id: SupportGroupId) => ({ "--group-strong": SUPPORT_GROUP_COLORS[id].strong, "--group-light": SUPPORT_GROUP_COLORS[id].light, "--group-ink": SUPPORT_GROUP_COLORS[id].ink }) as CSSProperties;
export type ActionsClient = Pick<ApiClient, "groupTasks" | "previewGroupTask" | "createGroupTask" | "groupTask" | "updateGroupTask" | "updateGroupTaskAreas" | "cancelGroupTask">;

const MORATORIUM = "moratorium" as const;

function CreateTask({ client, groupIds, label, customers, eventDate, scope, defaultDue, catalog, onCreated }: {
  client: ActionsClient; groupIds: SupportGroupId[]; label: string; customers: OutlookCustomer[]; eventDate: string;
  scope: string; defaultDue: string; catalog: GroupTaskList; onCreated: (task: GroupTask) => void;
}) {
  const [choice, setChoice] = useState<SolutionId | typeof MORATORIUM>(() => NEED_SOLUTIONS[groupIds[0]!][0]!);
  const [assigneeUserId, setAssignee] = useState(() => catalog.canAssignOthers ? "" : catalog.actorId);
  const [dueDate, setDueDate] = useState(defaultDue);
  const [preview, setPreview] = useState<GroupTaskPreview | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const isMoratorium = choice === MORATORIUM;
  const groupCustomers = useMemo(() => customers.filter((c) => groupIds.includes(groupOf(c))), [groupIds, customers]);
  // A moratorium covers the postcode areas where the selected customers live; the customer
  // selection stays the unit of thought, the area scope is inferred from it.
  const inferredPostcodes = useMemo(() => isMoratorium ? [...new Set(groupCustomers.map((c) => c.postcode).filter((p): p is string => !!p))] : [], [isMoratorium, groupCustomers]);
  const eligible = useMemo(() => isMoratorium ? [] : groupCustomers.filter((c) => solutionsFor(c).includes(choice)), [isMoratorium, groupCustomers, choice]);
  const choices = useMemo(() => [...new Set(groupIds.flatMap((id) => NEED_SOLUTIONS[id]).concat(customers.flatMap(solutionsFor)))], [groupIds, customers]);
  const moratoriumScope = useMemo(() => inferredPostcodes.length === 1
    ? groupCustomers.find((c) => c.postcode === inferredPostcodes[0])?.suburb ?? "Area"
    : `${inferredPostcodes.length} postcode areas`, [inferredPostcodes, groupCustomers]);
  const selection: GroupTaskSelection = useMemo(() => isMoratorium
    ? { kind: "moratorium", groupIds, solutionId: null, eventDate, scope: moratoriumScope, scopePostcodes: inferredPostcodes, personIds: [] }
    : { kind: "solution", groupIds, solutionId: choice, eventDate, scope, scopePostcodes: [], personIds: eligible.map((c) => c.personId) },
    [isMoratorium, groupIds, choice, eventDate, scope, moratoriumScope, inferredPostcodes, eligible]);
  const key = JSON.stringify(selection);
  useEffect(() => {
    let current = true; setPreview(null); setError(null);
    if (isMoratorium ? !inferredPostcodes.length : !eligible.length) { setPreview({ selected: 0, eligible: 0, duplicate: 0, unavailable: 0 }); return; }
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
    <label>Support task<select value={choice} onChange={(e) => setChoice(e.target.value as SolutionId | typeof MORATORIUM)} disabled={busy}>
      {choices.map((id) => <option key={id} value={id}>{SOLUTIONS[id].title}</option>)}
      <option value={MORATORIUM}>{DIRECTIVES.disconnection_moratorium.title}</option>
    </select></label>
    {isMoratorium ? <details className="task-instructions"><summary>Review the directive</summary><p>{DIRECTIVES.disconnection_moratorium.steps}</p>
    <p className="task-confirm"><strong>Confirm before the event:</strong> {DIRECTIVES.disconnection_moratorium.confirm}</p></details>
    : <details className="task-instructions"><summary>Review task steps</summary><p>{SOLUTIONS[choice].steps}</p>
    <p className="task-confirm"><strong>Confirm with each customer:</strong> {SOLUTIONS[choice].confirm}</p></details>}
    <label>Assign to<select required value={assigneeUserId} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
      <option value="">Choose a support worker</option>{catalog.users.filter((u) => catalog.canAssignOthers || u.id === catalog.actorId).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
    </select></label>
    <label>Due date<input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} /></label>
    <div className="task-selection-info" aria-live="polite">{preview ? isMoratorium ? <>
      <strong>{preview.eligible.toLocaleString("en-AU")} postcode areas</strong>
      {preview.duplicate ? <span>{preview.duplicate} already under a moratorium this week · excluded</span> : null}
      <span>{groupCustomers.length.toLocaleString("en-AU")} selected customers in these areas</span>
      {!inferredPostcodes.length ? <span>No selected customers have a mapped area.</span> : null}
    </> : <>
      <strong>{preview.eligible.toLocaleString("en-AU")} new customers</strong>
      {preview.duplicate ? <span>{preview.duplicate} already assigned or completed for this solution this forecast week · excluded</span> : null}
      {preview.unavailable ? <span>{preview.unavailable} no longer eligible · excluded</span> : null}
      {!preview.selected ? <span>No customers need this task in the current selection.</span> : null}
    </> : <span>Checking existing assignments…</span>}</div>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="link-btn" onClick={() => setRetry((r) => r + 1)}>Check again</button></div> : null}
    <button className="task-create" type="submit" disabled={busy || !preview?.eligible || !assigneeUserId || !dueDate}>
      {busy ? (isMoratorium ? "Issuing moratorium…" : "Creating task…") : isMoratorium
        ? `Issue disconnection moratorium · ${label} · ${preview?.eligible.toLocaleString("en-AU") ?? "…"} area${preview?.eligible === 1 ? "" : "s"}`
        : `Create group task · ${label} · ${preview?.eligible.toLocaleString("en-AU") ?? "…"}`}
    </button>
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
  async function updateAreas(postcodes: string[], completed: boolean) {
    if (!task || busy) return; setBusy(true); setError(null);
    try { await client.updateGroupTaskAreas!(id, { expectedVersion: task.version, postcodes, completed }); setRetry((r) => r + 1); onChanged(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!task || busy) return; setBusy(true); setError(null);
    try { await client.cancelGroupTask!(id, task.version); onChanged(); setRetry((r) => r + 1); setConfirmCancel(false); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const definition = task ? task.kind === "moratorium" ? DIRECTIVES.disconnection_moratorium : SOLUTIONS[task.solutionId!] : null;
  // Members (solutions) and postcode areas (moratoriums) share the same checklist markup.
  const checklist = task && detail
    ? task.kind === "moratorium"
      ? detail.areas.map((a) => ({ key: a.postcode, label: a.suburb ? `${a.postcode} · ${a.suburb}` : a.postcode, completed: a.completed, onToggle: () => void updateAreas([a.postcode], !a.completed), caseHref: null }))
      : detail.members.map((m) => ({ key: m.personId, label: m.displayName, completed: m.completed, onToggle: () => void update([m.personId], !m.completed), caseHref: m.accountNumber ? accountHref(m.accountNumber) : null }))
    : [];
  const remaining = checklist.filter((c) => !c.completed);
  return <div className="task-detail">
    <button type="button" className="link-btn" onClick={onBack}>← Back to actions</button>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="btn btn-small" disabled={busy} onClick={() => setRetry((r) => r + 1)}>Reload task</button></div> : null}
    {task && detail && definition ? <section className="support-solution-card task-detail-card" style={task.kind === "solution" ? styleFor(task.groupIds[0]!) : undefined}>
      <h3>{definition.title}</h3><p>{task.scope}</p>
      <p>Assigned to {catalog.users.find((u) => u.id === task.assigneeUserId)?.displayName ?? task.assigneeUserId} · Due {task.dueDate}</p>
      <strong className="task-progress-label">{task.cancelled ? "Cancelled" : `${task.completed} of ${task.total} completed`}</strong>
      {!task.cancelled ? <progress aria-label="Task completion" value={task.completed} max={task.total} /> : null}
      <p>{definition.steps}</p>
      <p className="task-confirm">{definition.confirm}</p>
      {!editable && !task.cancelled ? <p className="sub">Progress can be updated by the assigned worker or a manager.</p> : null}
      <ul className="task-member-list">{checklist.map((c) => <li key={c.key}>
        <label><input type="checkbox" checked={c.completed} disabled={!editable || busy} onChange={c.onToggle} /><span>{c.label}<small>{c.completed ? "Completed" : "To do"}</small></span></label>
        {c.caseHref ? <a href={c.caseHref} aria-label={`Open case for ${c.label}`}>Case ↗</a> : null}
      </li>)}</ul>
      {editable && remaining.length ? <button type="button" className="btn btn-small" disabled={busy} onClick={() => { if (task!.kind === "moratorium") void updateAreas(remaining.map((c) => c.key), true); else void update(remaining.map((c) => c.key), true); }}>Mark this page complete ({remaining.length})</button> : null}
      <div className="task-pager"><button type="button" className="btn btn-small" disabled={busy || page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {detail.page} / {detail.pageCount}</span><button type="button" className="btn btn-small" disabled={busy || page >= detail.pageCount} onClick={() => setPage((p) => p + 1)}>Next</button></div>
      {editable ? confirmCancel ? <div className="task-cancel-confirm"><p>Cancel this task and release its customer assignments?</p><button type="button" className="btn btn-small" disabled={busy} onClick={() => void cancel()}>Confirm cancellation</button><button type="button" className="link-btn" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep task</button></div> : <button type="button" className="link-btn" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel task</button> : null}
    </section> : <p role="status">Loading task…</p>}
  </div>;
}

export function SupportActions({ client, customers, groups, scope, eventDate, defaultDue, focusGroup, catalog, taskError, onRefresh }: {
  client: ActionsClient; customers: OutlookCustomer[]; groups: SupportGroupId[]; scope: string; eventDate: string; defaultDue: string;
  focusGroup: SupportGroupId | null; catalog: GroupTaskList | null; taskError: string | null; onRefresh: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(focusGroup ?? groups.at(-1) ?? null), [taskId, setTaskId] = useState<string | null>(null);
  const supported = !!(client.groupTasks && client.previewGroupTask && client.createGroupTask && client.groupTask && client.updateGroupTask && client.updateGroupTaskAreas && client.cancelGroupTask);
  useEffect(() => { setExpanded(focusGroup ?? groups.at(-1) ?? null); }, [groups.join("|"), focusGroup]);
  useEffect(() => { setTaskId(null); setNotice(null); }, [scope, eventDate, groups.join("|")]);
  if (!supported) return <p className="hint">Group tasks are unavailable on this server.</p>;
  const saved = (catalog?.tasks ?? []).filter((task) => task.kind === "moratorium" || task.groupIds.some((id) => groups.includes(id)));
  return <div className="support-actions">
    {taskError ? <div role="alert"><p>{taskError}</p><button type="button" className="link-btn" onClick={onRefresh}>Reload actions</button></div> : null}
    {notice ? <p className="task-notice" role="status">{notice}</p> : null}
    {!catalog ? <p role="status">Loading group tasks…</p> : taskId ? <TaskDetail key={taskId} client={client} id={taskId} catalog={catalog} onBack={() => setTaskId(null)} onChanged={onRefresh} /> : <>
      <p className="sub">Create and track tasks for the selected customers.</p>
      <div className="support-solution-stack">
        {groups.length > 1 ? <section className="support-solution-card action-group-card" data-group="all">
          <button type="button" className="solution-card-heading" aria-expanded={expanded === "all"} aria-controls="actions-all" onClick={() => setExpanded(expanded === "all" ? null : "all")}><span className="solution-group-badge">★</span><span><strong>All selected groups</strong><small>{customers.length.toLocaleString("en-AU")} customers selected</small></span><span aria-hidden="true">{expanded === "all" ? "−" : "+"}</span></button>
          <div id="actions-all" hidden={expanded !== "all"} className="solution-card-body">{expanded === "all" ? <CreateTask key={`all:${scope}:${eventDate}:${defaultDue}`} client={client} groupIds={groups} label="all selected groups" customers={customers} eventDate={eventDate} scope={scope} defaultDue={defaultDue} catalog={catalog} onCreated={(task) => { setNotice(task.kind === "moratorium" ? `Moratorium issued for ${task.scopePostcodes.length} postcode areas. No messages have been sent.` : `Task created for ${task.total} customers. No messages have been sent.`); onRefresh(); }} /> : null}</div>
        </section> : null}
        {groups.map((id) => {
          const definition = SUPPORT_GROUPS.find((g) => g.id === id)!, members = customers.filter((c) => groupOf(c) === id);
          const open = expanded === id;
          return <section key={id} className="support-solution-card action-group-card" style={styleFor(id)} data-group={id}>
            <button type="button" className="solution-card-heading" aria-expanded={open} aria-controls={`actions-${id}`} onClick={() => setExpanded(open ? null : id)}><span className="solution-group-badge">{definition.letter}</span><span><strong>{definition.label}</strong><small>{members.length.toLocaleString("en-AU")} customers selected</small></span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
            <div id={`actions-${id}`} hidden={!open} className="solution-card-body">{open ? <CreateTask key={`${id}:${scope}:${eventDate}:${defaultDue}`} client={client} groupIds={[id]} label={definition.label.toLowerCase()} customers={members} eventDate={eventDate} scope={scope} defaultDue={defaultDue} catalog={catalog} onCreated={(task) => { setNotice(task.kind === "moratorium" ? `Moratorium issued for ${task.scopePostcodes.length} postcode areas. No messages have been sent.` : `Task created for ${task.total} customers. No messages have been sent.`); onRefresh(); }} /> : null}</div>
          </section>;
        })}
      </div>
      {!groups.length ? <p className="hint">Turn on a group filter to create a task.</p> : null}
      <section className="saved-group-tasks"><h3>Saved tasks · forecast week</h3><p className="sub">Across all areas for the selected groups, plus area directives</p>
        {saved.map((task) => <article key={task.id} className="saved-group-task" style={task.kind === "solution" ? styleFor(task.groupIds[0]!) : undefined}>
          <strong>{task.kind === "moratorium" ? DIRECTIVES.disconnection_moratorium.title : SOLUTIONS[task.solutionId!].title}</strong><span>{task.scope}</span><small>Due {task.dueDate} · {catalog?.users.find((u) => u.id === task.assigneeUserId)?.displayName}</small>
          <span>{task.cancelled ? "Cancelled" : task.kind === "moratorium" ? "Active" : task.completed === task.total ? "Completed" : task.completed ? "In progress" : "To do"}{task.kind !== "moratorium" ? ` · ${task.completed} / ${task.total}` : ""}</span>
          {task.kind !== "moratorium" ? <progress aria-label={`${SOLUTIONS[task.solutionId!].title} completion`} value={task.completed} max={task.total} /> : null}
          <button type="button" className="btn btn-small" onClick={() => setTaskId(task.id)}>View task</button>
        </article>)}
        {!saved.length ? <p className="sub">No tasks created for these groups this forecast week.</p> : null}
      </section>
    </>}
    <p className="support-caution">Creating a task organises work in this app. It does not contact customers or change their account.</p>
  </div>;
}
